/**
 * Flow Scheduler - Node-Controlled Execution
 *
 * Architecture:
 * - Nodes are autonomous functions that control their own execution
 * - Nodes decide when to pull inputs (lazy evaluation)
 * - Nodes decide when they're "done" (different logic per node type)
 * - Nodes call successors when complete (via return value)
 * - Scheduler provides infrastructure (FlowAPI, pull functions) but doesn't make execution decisions
 *
 * Key concepts:
 * - PUSH: A node completes and calls its successors with outputs
 * - PULL: A node needs an input and executes the source node to get it (lazy)
 * - Nodes handle their own caching via store (no scheduler cache)
 * - Nodes are async functions that await naturally (no pause/resume state machine)
 */

import type { WebContents } from 'electron'
import type {
  MainFlowContext,
  FlowDefinition,
  Edge,
  NodeOutput,
  FlowExecutionArgs,
  NodeInputs,
} from './types'
import type { FlowAPI, Badge, Tool, UsageReport } from './flow-api'
import type { ExecutionEvent } from './execution-events'
import { getNodeFunction } from './nodes'
import { createContextAPI } from './context-api'
import { createEventEmitter } from './execution-events'

export class FlowScheduler {
  // Graph structure
  private flowDef: FlowDefinition
  private incomingEdges = new Map<string, Edge[]>()
  private outgoingEdges = new Map<string, Edge[]>()

  // Cached store reference (lazy-loaded to avoid circular dependency)
  private storeCache: any = null

  // Helper to get store (avoids circular dependency)
  private async getStore() {
    if (!this.storeCache) {
      const mod = await import('../../store')
      this.storeCache = mod.useMainStore.getState
    }
    return this.storeCache()
  }

  // Execution context
  private requestId: string

  // WebContents for Zustand bridge (IPC communication with renderer)
  // Only used for fetching configs and state, NOT for sending events
  // Note: Currently unused as we access store directly, but kept for potential future use
  // @ts-expect-error - Kept for potential future use
  private _wc: WebContents | undefined

  // Abort controller for cancellation
  private abortController = new AbortController()

  // User input promises: for nodes waiting for external input
  private userInputResolvers = new Map<string, (value: string) => void>()

  // Multi-context tracking: main context + isolated contexts
  private mainContext: MainFlowContext
  private isolatedContexts = new Map<string, MainFlowContext>()

  // Output memoization - cache node outputs to prevent duplicate execution
  private nodeOutputCache = new Map<string, NodeOutput>()

  constructor(
    wc: WebContents | undefined,
    requestId: string,
    flowDef: FlowDefinition,
    args: FlowExecutionArgs
  ) {
    this._wc = wc
    this.requestId = requestId
    this.flowDef = flowDef

    // Initialize main context from session context (single source of truth)
    // If no session context provided, create default
    if (args.initialContext) {
      this.mainContext = {
        contextId: 'main',
        contextType: 'main',
        provider: args.initialContext.provider,
        model: args.initialContext.model,
        systemInstructions: args.initialContext.systemInstructions,
        messageHistory: args.initialContext.messageHistory || []
      }
      console.log('[Scheduler] Initialized from session context:', {
        provider: this.mainContext.provider,
        model: this.mainContext.model,
        messageCount: this.mainContext.messageHistory.length
      })
    } else {
      // Fallback: create default context (should rarely happen)
      this.mainContext = {
        contextId: 'main',
        contextType: 'main',
        provider: 'openai',
        model: 'gpt-4o',
        messageHistory: [],
        systemInstructions: undefined
      }
      console.warn('[Scheduler] No session context provided, using defaults')
    }

    this.buildGraphStructure()
  }
  
  /**
   * Build graph structure for efficient edge lookups
   */
  private buildGraphStructure(): void {
    for (const edge of this.flowDef.edges) {
      // Use handle names directly as field names (no mapping needed!)
      // sourceHandle 'context' → sourceOutput 'context'
      // targetHandle 'context' → targetInput 'context'
      const mappedEdge: Edge = {
        ...edge,
        sourceOutput: edge.sourceHandle || 'context',
        targetInput: edge.targetHandle || 'context',
      }

      // Incoming edges (for pulling)
      const incoming = this.incomingEdges.get(edge.target) || []
      incoming.push(mappedEdge)
      this.incomingEdges.set(edge.target, incoming)

      // Outgoing edges (for pushing)
      const outgoing = this.outgoingEdges.get(edge.source) || []
      outgoing.push(mappedEdge)
      this.outgoingEdges.set(edge.source, outgoing)
    }
  }

  /**
   * Execute the flow starting from entry nodes
   *
   * This function should NEVER return under normal circumstances - the flow runs indefinitely,
   * waiting at userInput nodes for user interaction. It only returns on error or cancellation.
   */
  async execute(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Find the entry node - there should be exactly one: defaultContextStart
      // We explicitly look for this node type rather than assuming nodes with no incoming edges are entry nodes
      const entryNode = this.flowDef.nodes.find(n => n.type === 'defaultContextStart')

      if (!entryNode) {
        throw new Error('No defaultContextStart node found in flow - every flow must have exactly one entry node')
      }

      // Execute the entry node with the scheduler's main context
      // This ensures message history from the session is preserved
      // This will trigger the flow execution, which should eventually reach a userInput node
      // and wait indefinitely for user input
      await this.executeNode(entryNode.id, { context: this.mainContext }, null)

      // Don't return - wait indefinitely for user input
      // The flow should only complete if explicitly cancelled or if an error occurs
      return new Promise(() => {
        // This promise never resolves - the flow waits indefinitely
        // It can only be cancelled by external means (e.g., user cancels the flow)
      })
    } catch (e: any) {
      const error = e?.message || String(e)
      console.error('[FlowScheduler] Error:', error)
      const store = await this.getStore()
      store.feHandleError(error)
      return { ok: false, error }
    }
  }
  
  /**
   * Execute a node with push/pull model
   *
   * @param nodeId - The node to execute
   * @param pushedInputs - Inputs provided by the caller (push)
   * @param callerId - ID of the node that called this one (for logging and preventing pull cycles)
   * @param isPull - If true, this execution is from a pull (don't push to successors)
   */
  private async executeNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null,
    isPull: boolean = false
  ): Promise<NodeOutput> {
    // In the new architecture, nodes handle their own caching and cycle prevention
    // The scheduler just executes the node
    console.log(`[Scheduler] ${nodeId} - Executing node`, {
      pushedInputs: Object.keys(pushedInputs),
      callerId,
      isPull
    })

    return this.doExecuteNode(nodeId, pushedInputs, callerId, isPull)
  }
  
  /**
   * Actually execute the node
   * In the new architecture, nodes control their own pulling via the inputs.pull() function
   */
  private async doExecuteNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null,
    isPull: boolean = false
  ): Promise<NodeOutput> {
    const startTime = Date.now()

    // Generate unique execution ID for this node execution
    const executionId = crypto.randomUUID()
    console.log(`[Scheduler] ${nodeId} - Starting execution ${executionId}, isPull: ${isPull}, callerId: ${callerId}, pushedInputs:`, Object.keys(pushedInputs))

    const store = await this.getStore()
    store.feHandleNodeStart(nodeId)

    try {
      // Refresh main context provider/model from Zustand before executing
      // This ensures we always use the latest values from the UI for the main context
      await this.refreshMainContextFromStore()

      // Get node configuration from renderer (fresh on every execution)
      const nodeConfig = this.flowDef.nodes.find(n => n.id === nodeId)
      const config = await this.getNodeConfig(nodeId)

      // Extract context and data from pushed inputs
      // Context follows the same rules as other inputs - it's either pushed or needs to be pulled
      const contextIn = pushedInputs.context
      const dataIn = pushedInputs.data

      if (contextIn) {
        console.log(`[Scheduler] ${nodeId} - Using context from edge:`, {
          contextId: contextIn.contextId,
          contextType: contextIn.contextType,
          provider: contextIn.provider,
          model: contextIn.model
        })
      } else {
        console.log(`[Scheduler] ${nodeId} - No context pushed (node may pull or create its own)`)
      }

      // Create FlowAPI instance for this node execution
      const flowAPI = this.createFlowAPI(nodeId, executionId)

      // Create NodeInputs with pull/has functions
      const inputs: NodeInputs = {
        pull: this.createPullFunction(nodeId),
        has: this.createHasFunction(nodeId, pushedInputs)
      }

      // Execute the node function with new signature
      const nodeFunction = getNodeFunction(nodeConfig!)
      const result = await nodeFunction(flowAPI, contextIn, dataIn, inputs, config)

      // Update context tracking based on result
      if (result.context) {
        const resultContext = result.context

        if (resultContext.contextType === 'main' || !resultContext.contextType) {
          // Update main context
          this.mainContext = resultContext
          console.log(`[Scheduler] ${nodeId} - Updated main context:`, {
            contextId: this.mainContext.contextId,
            messageHistoryLength: this.mainContext.messageHistory.length
          })

          // Sync to store for UI display
          console.log(`[Scheduler] ${nodeId} - About to call feUpdateMainFlowContext`)
          store.feUpdateMainFlowContext(this.mainContext)
          console.log(`[Scheduler] ${nodeId} - feUpdateMainFlowContext returned`)
        } else if (resultContext.contextType === 'isolated') {
          // Update isolated context
          this.isolatedContexts.set(resultContext.contextId, resultContext)
          console.log(`[Scheduler] ${nodeId} - Updated isolated context:`, {
            contextId: resultContext.contextId,
            messageHistoryLength: resultContext.messageHistory.length,
            totalIsolatedContexts: this.isolatedContexts.size
          })

          // Also sync to store (for now, just use the main context update)
          // TODO: Update store to handle multiple contexts
          store.feUpdateMainFlowContext(resultContext)
        }
      }

      const durationMs = Date.now() - startTime
      console.log(`[Scheduler] ${nodeId} - Calling feHandleNodeEnd, durationMs:`, durationMs)
      store.feHandleNodeEnd(nodeId, durationMs)
      console.log(`[Scheduler] ${nodeId} - feHandleNodeEnd completed`)

      // Check for error status - stop execution if node failed
      if (result.status === 'error') {
        const errorMsg = result.error || 'Node execution failed'
        console.error(`[Scheduler] ${nodeId} - ERROR:`, errorMsg)
        store.feHandleError(`${nodeId}: ${errorMsg}`)
        throw new Error(errorMsg)
      }

      console.log(`[Scheduler] ${nodeId} - About to enter PUSH phase, isPull:`, isPull)

      // PUSH PHASE: Call successors with our outputs
      // Skip this phase if node was executed via pull (caller is waiting for return value)
      if (!isPull) {
        // Note: Some nodes (like tools) are pull-only and don't push to successors
        const outgoingEdges = this.outgoingEdges.get(nodeId) || []

        console.log(`[Scheduler] ${nodeId} - PUSH phase:`, {
          outgoingEdges: outgoingEdges.length,
          resultKeys: Object.keys(result),
          status: result.status
        })

        // Filter out pull-only edges (tools edges should only be pulled, not pushed)
        const pushEdges = outgoingEdges.filter(edge => {
          // Tools edges are pull-only - they should not trigger execution
          if (edge.sourceOutput === 'tools') {
            return false
          }
          return true
        })

        const successorIds = new Set(pushEdges.map(e => e.target))

        for (const successorId of successorIds) {
          // Collect all outputs going to this successor
          const pushedData: Record<string, any> = {}

          for (const edge of pushEdges) {
            if (edge.target === successorId) {
              const sourceOutput = edge.sourceOutput
              const targetInput = edge.targetInput

              if (sourceOutput in result) {
                const value = (result as any)[sourceOutput]
                pushedData[targetInput] = value
              }
            }
          }

          // Only push to successor if we have data to push
          // This prevents calling successors with empty inputs (which would be treated as a pull)
          if (Object.keys(pushedData).length > 0) {
            console.log(`[Scheduler] ${nodeId} - Pushing to ${successorId}:`, Object.keys(pushedData))
            await this.executeNode(successorId, pushedData, nodeId)
          } else {
            console.log(`[Scheduler] ${nodeId} - NOT pushing to ${successorId} (no data)`)
          }
        }
      } else {
        console.log(`[Scheduler] ${nodeId} - SKIP push phase (executed via pull)`)
      }
      
      return result
    } catch (e: any) {
      const error = e?.message || String(e)
      console.error(`[FlowScheduler] Error in ${nodeId}:`, error)
      const store = await this.getStore()
      store.feHandleError(error)
      throw e
    }
  }

  /**
   * Create FlowAPI instance for a node execution
   */
  private createFlowAPI(nodeId: string, executionId: string): FlowAPI {
    // Create event emitter for this execution
    const emit = createEventEmitter(executionId, nodeId, (event: ExecutionEvent) => {
      this.handleExecutionEvent(event)
    })

    return {
      nodeId,
      requestId: this.requestId,
      executionId,
      signal: this.abortController.signal,
      checkCancelled: () => {
        if (this.abortController.signal.aborted) {
          throw new Error('Flow execution cancelled')
        }
      },
      emitExecutionEvent: emit,
      store: this.storeCache?.() || {},
      context: createContextAPI(),
      conversation: {
        streamChunk: (chunk: string) => {
          // TODO: Implement streaming to conversation UI
          console.log(`[Stream] ${nodeId}:`, chunk)
        },
        addBadge: (badge: Badge) => {
          // TODO: Implement badge creation
          const badgeId = `badge-${Date.now()}`
          console.log(`[Badge] ${nodeId}:`, badge)
          return badgeId
        },
        updateBadge: (badgeId: string, updates: Partial<Badge>) => {
          // TODO: Implement badge updates
          console.log(`[Badge Update] ${badgeId}:`, updates)
        }
      },
      log: {
        debug: (message: string, data?: any) => {
          console.log(`[Flow Debug] ${nodeId}:`, message, data)
        },
        info: (message: string, data?: any) => {
          console.log(`[Flow Info] ${nodeId}:`, message, data)
        },
        warn: (message: string, data?: any) => {
          console.warn(`[Flow Warn] ${nodeId}:`, message, data)
        },
        error: (message: string, data?: any) => {
          console.error(`[Flow Error] ${nodeId}:`, message, data)
        }
      },
      tools: {
        execute: async (toolName: string, args: any) => {
          // TODO: Implement tool execution
          console.log(`[Tool] ${nodeId}: ${toolName}`, args)
          return {}
        },
        list: () => {
          // Return agent tools from global registry
          return (globalThis as any).__agentTools || []
        }
      },
      usage: {
        report: (usage: UsageReport) => {
          // TODO: Implement usage reporting and cost calculation
          console.log(`[Usage] ${nodeId}:`, usage)
        }
      },
      waitForUserInput: async () => {
        console.log('[FlowAPI.waitForUserInput] Waiting for input, nodeId:', nodeId)

        // Notify store that we're waiting for input
        const store = await this.getStore()
        store.feHandleWaitingForInput(nodeId, this.requestId)

        // Create a promise that will be resolved when resumeWithInput is called
        const userInput = await new Promise<string>((resolve) => {
          console.log('[FlowAPI.waitForUserInput] Storing resolver for nodeId:', nodeId)
          this.userInputResolvers.set(nodeId, resolve)
        })

        console.log('[FlowAPI.waitForUserInput] Received input:', userInput.substring(0, 50))
        this.userInputResolvers.delete(nodeId)
        return userInput
      },
      triggerPortalOutputs: async (portalId: string) => {
        console.log(`[FlowAPI.triggerPortalOutputs] Triggering portal outputs for ID: ${portalId}`)
        await this.triggerPortalOutputs(portalId)
      }
    }
  }

  /**
   * Handle execution events from providers and nodes
   * Routes events to appropriate store handlers based on event type
   */
  private async handleExecutionEvent(event: ExecutionEvent): Promise<void> {
    console.log(`[ExecutionEvent] ${event.nodeId} [${event.executionId}]:`, event.type, event)

    const store = await this.getStore()

    switch (event.type) {
      case 'chunk':
        if (event.chunk) {
          store.feHandleChunk(event.chunk, event.nodeId, event.provider, event.model)
        }
        break

      case 'tool_start':
        if (event.tool) {
          store.feHandleToolStart(
            event.tool.toolName,
            event.nodeId,
            event.tool.toolArgs,
            event.tool.toolCallId,
            event.provider,
            event.model
          )
        }
        break

      case 'tool_end':
        if (event.tool) {
          store.feHandleToolEnd(event.tool.toolName, event.tool.toolCallId, event.nodeId)
        }
        break

      case 'tool_error':
        if (event.tool) {
          store.feHandleToolError(
            event.tool.toolName,
            event.tool.toolError || 'Unknown error',
            event.tool.toolCallId,
            event.nodeId
          )
        }
        break

      case 'usage':
        if (event.usage) {
          store.feHandleTokenUsage(event.provider, event.model, {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens
          })
        }
        break

      case 'done':
        // Flow execution completed
        store.feHandleDone()
        break

      case 'error':
        if (event.error) {
          store.feHandleError(event.error)
        }
        break

      default:
        console.warn(`[ExecutionEvent] Unknown event type:`, event.type)
    }
  }

  /**
   * Create pull function for a node
   * Allows nodes to lazily pull from connected inputs
   */
  private createPullFunction(nodeId: string): (inputName: string) => Promise<any> {
    return async (inputName: string) => {
      console.log(`[Pull] ${nodeId} attempting to pull ${inputName}`)

      const incomingEdges = this.incomingEdges.get(nodeId) || []
      console.log(`[Pull] ${nodeId} has ${incomingEdges.length} incoming edges`)

      const edge = incomingEdges.find(e => e.targetInput === inputName)

      if (!edge) {
        console.error(`[Pull] ${nodeId} - No edge found for input '${inputName}'`)
        throw new Error(`No edge found for input '${inputName}' on node '${nodeId}'`)
      }

      console.log(`[Pull] ${nodeId} pulling ${inputName} from ${edge.source}.${edge.sourceOutput}`)

      // Execute source node to get the value
      // Pass isPull=true to prevent the source from pushing to successors
      const sourceResult = await this.executeNode(edge.source, {}, nodeId, true)

      console.log(`[Pull] ${nodeId} received result from ${edge.source}`)

      // Extract the specific output
      if (edge.sourceOutput in sourceResult) {
        return (sourceResult as any)[edge.sourceOutput]
      }

      return undefined
    }
  }

  /**
   * Create has function for a node
   * Checks if an input is available (either pushed OR can be pulled)
   *
   * IMPORTANT: If an input was already pushed, we should NOT try to pull from other edges
   * targeting the same input. This prevents pulling from edges we already received data from.
   */
  private createHasFunction(nodeId: string, pushedInputs: Record<string, any>): (inputName: string) => boolean {
    return (inputName: string) => {
      // If input was already pushed, we have it - don't pull
      if (inputName in pushedInputs) {
        return true
      }

      // Check if there's an edge connected to this input that we can pull from
      // Only return true if we can pull (input not already satisfied)
      const incomingEdges = this.incomingEdges.get(nodeId) || []
      const edgesForInput = incomingEdges.filter(e => e.targetInput === inputName)

      // If multiple edges target the same input, this is invalid graph structure
      // We can't pull because we don't know which edge to use
      if (edgesForInput.length > 1) {
        console.warn(`[Scheduler] ${nodeId} - Multiple edges target input '${inputName}' - cannot pull`)
        return false
      }

      return edgesForInput.length === 1
    }
  }



  /**
   * Update provider/model for the main context (mid-flow switching)
   * This updates the main context to use new provider/model from the UI
   */
  updateProviderModel(provider?: string, model?: string): void {
    if (provider) {
      this.mainContext.provider = provider
    }
    if (model) {
      this.mainContext.model = model
    }
    console.log('[Scheduler] Updated main context provider/model:', {
      provider: this.mainContext.provider,
      model: this.mainContext.model
    })
  }

  /**
   * Get current node configuration from main store
   * This fetches the config fresh from the store on every call
   */
  private async getNodeConfig(nodeId: string): Promise<Record<string, any>> {
    try {
      // Read directly from main store (no IPC needed!)
      const store = await this.getStore()
      const node = store.feNodes.find((n: any) => n.id === nodeId)
      const config = (node?.data as any)?.config || {}

      // Return a copy to prevent mutations
      return JSON.parse(JSON.stringify(config))
    } catch (error: any) {
      console.error(`[FlowScheduler] Error getting config for ${nodeId}:`, error)
      return {}
    }
  }

  /**
   * Refresh main context provider/model from session context in store
   * This ensures we always use the latest values from the session
   */
  private async refreshMainContextFromStore(): Promise<void> {
    try {
      // Read session context from main store (single source of truth)
      const store = await this.getStore()
      const currentSession = store.sessions?.find((s: any) => s.id === store.currentId)

      if (currentSession?.currentContext) {
        const sessionContext = currentSession.currentContext

        // Only update main context provider/model (preserve message history)
        // Message history is managed by nodes, not by UI changes
        if (sessionContext.provider !== this.mainContext.provider ||
            sessionContext.model !== this.mainContext.model) {
          this.mainContext.provider = sessionContext.provider
          this.mainContext.model = sessionContext.model
          console.log('[Scheduler] Refreshed main context from session:', {
            provider: this.mainContext.provider,
            model: this.mainContext.model
          })
        }
      }
    } catch (error: any) {
      console.error('[FlowScheduler] Error refreshing main context from store:', error)
    }
  }



  /**
   * Resolve a waiting user input promise
   * This doesn't "resume" the flow - the flow is already running, just awaiting this promise
   */
  resolveUserInput(nodeId: string, userInput: string): void {
    console.log('[scheduler.resolveUserInput] Attempting to resolve nodeId:', nodeId)
    console.log('[scheduler.resolveUserInput] Available resolvers:', Array.from(this.userInputResolvers.keys()))

    const resolver = this.userInputResolvers.get(nodeId)
    if (resolver) {
      console.log('[scheduler.resolveUserInput] Found resolver, resolving with input')
      resolver(userInput)
    } else {
      console.error('[scheduler.resolveUserInput] No resolver found for nodeId:', nodeId)
    }
  }

  /**
   * Resolve ANY waiting user input promise (used when we don't know the exact nodeId)
   * This is called by resumeFlow when the user submits input
   */
  resolveAnyWaitingUserInput(userInput: string): void {
    console.log('[scheduler.resolveAnyWaitingUserInput] Available resolvers:', Array.from(this.userInputResolvers.keys()))

    // There should only be one waiting resolver at a time
    // (userInput nodes execute sequentially)
    if (this.userInputResolvers.size === 0) {
      console.warn('[scheduler.resolveAnyWaitingUserInput] No waiting user input resolvers found')
      return
    }

    if (this.userInputResolvers.size > 1) {
      console.warn('[scheduler.resolveAnyWaitingUserInput] Multiple waiting user input resolvers found, resolving the first one')
    }

    // Get the first (and should be only) resolver
    const entry = this.userInputResolvers.entries().next().value
    if (entry) {
      const [nodeId, resolver] = entry
      console.log('[scheduler.resolveAnyWaitingUserInput] Resolving user input for node:', nodeId)
      resolver(userInput)
    }
  }

  /**
   * Trigger all Portal Output nodes with matching ID
   * Called by Portal Input nodes after storing data
   */
  async triggerPortalOutputs(portalId: string): Promise<void> {
    console.log(`[Scheduler] Triggering portal outputs for ID: ${portalId}`)

    // Find all Portal Output nodes with matching ID
    const portalOutputNodes = this.flowDef.nodes.filter(node => {
      return node.type === 'portalOutput' && node.config?.id === portalId
    })

    console.log(`[Scheduler] Found ${portalOutputNodes.length} portal output nodes with ID: ${portalId}`)

    // Execute each Portal Output node (push-trigger)
    for (const node of portalOutputNodes) {
      console.log(`[Scheduler] Triggering portal output node: ${node.id}`)
      await this.executeNode(node.id, {}, null, false)
    }
  }
}


