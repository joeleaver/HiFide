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
import type { FlowAPI, Badge, UsageReport } from './flow-api'
import type { ExecutionEvent } from './execution-events'
import { getNodeFunction } from './nodes'
import { createContextAPI } from './context-api'
import { createEventEmitter } from './execution-events'

import util from 'node:util'

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

  // Input waiters (for gating starts on required inputs like 'context')
  private inputWaiters = new Map<string, Map<string, Array<() => void>>>()

  // Multi-context tracking: main context + isolated contexts
  private mainContext: MainFlowContext
  private isolatedContexts = new Map<string, MainFlowContext>()

  // Track in-flight node executions to avoid duplicate work during pulls
  private inFlightExecutions = new Map<string, Promise<NodeOutput>>()

  // Live pushed inputs for the current execution of each node (mutable during execution)
  private pushedInputsByNode = new Map<string, Record<string, any>>()

  // Pending pushed inputs for nodes not yet started (coalesced until safe to start)
  private pendingPushesByNode = new Map<string, Record<string, any>>()

  // Output memoization - cache node outputs to prevent duplicate execution
  // private nodeOutputCache = new Map<string, NodeOutput>()

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
    // Use requestId as contextId so terminal tools bind to the session's PTY
    // If no session context provided, create default
    if (args.initialContext) {
      this.mainContext = {
        contextId: requestId,  // Use requestId (session ID) as contextId for terminal binding
        contextType: 'main',
        provider: args.initialContext.provider,
        model: args.initialContext.model,
        systemInstructions: args.initialContext.systemInstructions,
        messageHistory: args.initialContext.messageHistory || []
      }
      console.log('[Scheduler] Initialized from session context:', {
        contextId: this.mainContext.contextId,
        provider: this.mainContext.provider,
        model: this.mainContext.model,
        messageCount: this.mainContext.messageHistory.length
      })
    } else {
      // Fallback: create default context (should rarely happen)
      this.mainContext = {
        contextId: requestId,  // Use requestId as contextId for terminal binding
        contextType: 'main',
        provider: 'openai',
        model: 'gpt-4o',
        messageHistory: [],
        systemInstructions: undefined
      }
      console.warn('[Scheduler] No session context provided, using defaults')
    }

    this.buildGraphStructure()
    // Mark private helpers as referenced to satisfy noUnusedPrivateMembers while keeping them available
    void this.waitForNodeInput

  }

  /**
   * Cancel the flow execution cooperatively
   * Aborts the shared signal; nodes and providers should listen and stop promptly
   */
  public cancel(): void {
    try {
      if (!this.abortController.signal.aborted) {
        this.abortController.abort()
      }
    } catch {}

    // Resolve any pending user input promises to unblock waiters
    try {
      for (const resolve of this.userInputResolvers.values()) {
        try { resolve('') } catch {}
      }
      this.userInputResolvers.clear()
    } catch {}
  }

  /**
   * Canonicalize handle names to core outputs/inputs used by the scheduler
   * We accept common variants from the editor (e.g., contextIn/contextOut, dataOut/value)
   */
  private canonicalizeHandleName(name?: string | null): 'context' | 'data' | 'tools' | string {
    if (!name) return 'context'
    const raw = String(name).trim().toLowerCase()
    // remove separators for easy matching
    const n = raw.replace(/\s+|[-_]/g, '')

    // context synonyms
    if (n === 'context' || n === 'contextin' || n === 'contextout' || n === 'ctx' || n === 'ctxin' || n === 'ctxout') {
      return 'context'
    }

    // data/value synonyms
    if (n === 'data' || n === 'datain' || n === 'dataout' || n === 'value' || n === 'output') {
      return 'data'
    }

    // tools synonyms
    if (n === 'tools' || n === 'toolsin' || n === 'toolsout') {
      return 'tools'
    }

    // Unknown: keep original to avoid over-normalizing
    return name
  }

  /**
   * Build graph structure for efficient edge lookups
   *
   * Portals are treated as invisible wiring. We rewrite edges so that
   * portalInput -> portalOutput connections are bridged directly between
   * the original source and the final target, matching by handle name.
   */
  private buildGraphStructure(): void {
    // Clear any previous maps (defensive if called more than once)
    this.incomingEdges.clear()
    this.outgoingEdges.clear()


    const nodesById = new Map<string, any>()
    for (const n of this.flowDef.nodes) {
      nodesById.set(n.id, n)
    }

    // Canonicalize all declared edges first
    const baseEdges: Edge[] = []
    for (const edge of this.flowDef.edges) {
      const mapped: Edge = {
        ...edge,
        sourceOutput: this.canonicalizeHandleName(edge.sourceHandle),
        targetInput: this.canonicalizeHandleName(edge.targetHandle),
      }
      baseEdges.push(mapped)
    }

    // Build portal index by portal id (config.id)
    const portalInputsByKey = new Map<string, string[]>() // portalId -> nodeIds
    const portalOutputsByKey = new Map<string, string[]>()

    for (const n of this.flowDef.nodes) {
      const nodeType = (n as any).nodeType || (n as any).type
      if (nodeType !== 'portalInput' && nodeType !== 'portalOutput') continue
      const pid = (n as any)?.config?.id
      if (!pid) continue
      if (nodeType === 'portalInput') {
        const arr = portalInputsByKey.get(pid) || []
        arr.push(n.id)
        portalInputsByKey.set(pid, arr)
      } else {
        const arr = portalOutputsByKey.get(pid) || []
        arr.push(n.id)
        portalOutputsByKey.set(pid, arr)
      }
    }

    // Helper to check whether an edge touches a portal node
    const isPortalNodeId = (id: string) => {
      const node = nodesById.get(id)
      if (!node) return false
      const t = (node as any).nodeType || (node as any).type
      return t === 'portalInput' || t === 'portalOutput'
    }

    // Collect edges that do NOT touch portals
    const nonPortalEdges: Edge[] = baseEdges.filter(e => !isPortalNodeId(e.source) && !isPortalNodeId(e.target))

    // For each portal key, create bridged edges from incoming-to-portalInput to outgoing-from-portalOutput
    const bridgedEdges: Edge[] = []
    for (const [portalKey, inputNodeIds] of portalInputsByKey.entries()) {
      const outputNodeIds = portalOutputsByKey.get(portalKey) || []
      if (outputNodeIds.length === 0) continue // no outputs => nothing to bridge

      // Incoming edges to any portalInput with this key
      const incomingToPortal: Edge[] = baseEdges.filter(e => inputNodeIds.includes(e.target))
      // Outgoing edges from any portalOutput with this key
      const outgoingFromPortal: Edge[] = baseEdges.filter(e => outputNodeIds.includes(e.source))

      // Bridge by matching handle names: sourceOutput (incoming) -> targetInput (outgoing)
      for (const out of outgoingFromPortal) {
        for (const inn of incomingToPortal) {
          if (out.targetInput !== inn.sourceOutput) continue // only bridge like-for-like handles

          const newEdge: Edge = {
            id: `bridge:${inn.id}=>${out.id}`,
            source: inn.source,
            sourceOutput: inn.sourceOutput,
            sourceHandle: inn.sourceOutput, // keep for compatibility
            target: out.target,
            targetInput: out.targetInput,
            targetHandle: out.targetInput,
            metadata: {
              ...(inn.metadata || {}),
              // Preserve explicit context flag if either side marked it
              isContextEdge: (inn.metadata?.isContextEdge ?? false) || (out.metadata?.isContextEdge ?? false)
            }
          }
          bridgedEdges.push(newEdge)
        }
      }
    }

    // Combine and de-duplicate edges
    const dedup = new Map<string, Edge>()
    const pushUnique = (e: Edge) => {
      const key = `${e.source}|${e.sourceOutput}|${e.target}|${e.targetInput}`
      if (!dedup.has(key)) dedup.set(key, e)
    }

    for (const e of nonPortalEdges) pushUnique(e)
    for (const e of bridgedEdges) pushUnique(e)

    const finalEdges = Array.from(dedup.values())

    // Populate incoming/outgoing maps
    for (const e of finalEdges) {
      const incoming = this.incomingEdges.get(e.target) || []
      incoming.push(e)
      this.incomingEdges.set(e.target, incoming)

      const outgoing = this.outgoingEdges.get(e.source) || []
      outgoing.push(e)
      this.outgoingEdges.set(e.source, outgoing)
    }

    // Debug: show bridged wiring summary
    try {
      const bridgedCount = bridgedEdges.length
      if (bridgedCount > 0) {
        console.log(`[Scheduler] Portal bridging created ${bridgedCount} virtual edge(s) (portals invisible).`)
      }
    } catch {}
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
      let entryNode = this.flowDef.nodes.find((n: any) => (n.nodeType === 'defaultContextStart') || (n.type === 'defaultContextStart'))

      if (!entryNode) {
        // Fallback: allow flows without defaultContextStart by selecting the single node with no incoming edges
        const incomingByTarget = new Map<string, number>()
        for (const n of this.flowDef.nodes) incomingByTarget.set(n.id, 0)
        for (const e of this.flowDef.edges) {
          incomingByTarget.set(e.target, (incomingByTarget.get(e.target) || 0) + 1)
        }
        const candidates = this.flowDef.nodes.filter(n => (incomingByTarget.get(n.id) || 0) === 0)
        if (candidates.length === 1) {
          console.warn('[FlowScheduler] No defaultContextStart found - using lone entry node', candidates[0].id)
          entryNode = candidates[0]
        } else {
          throw new Error('No defaultContextStart node found in flow - every flow must have exactly one entry node')
        }
      }

      // Before starting, override provider/model from global selection to match UI
      try {
        const store = await this.getStore()
        const provider = store?.selectedProvider || 'openai'
        const model = store?.selectedModel || 'gpt-4o'
        this.mainContext.provider = provider
        this.mainContext.model = model
        console.log('[Scheduler] Using global selection for main context:', { provider, model })
      } catch (e) {
        console.warn('[Scheduler] Could not read global selection; using existing context provider/model')
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

    // Register initial pushed inputs for this execution (mutable during execution)
    this.pushedInputsByNode.set(nodeId, { ...(pushedInputs || {}) })

    // Register in-flight execution so pulls can await instead of re-executing
    const promise = this.doExecuteNode(nodeId, pushedInputs, callerId, isPull)
    this.inFlightExecutions.set(nodeId, promise)
    // Clean up when done
    promise.finally(() => {
      this.inFlightExecutions.delete(nodeId)
      this.pushedInputsByNode.delete(nodeId)
    })
    return promise
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
    // Cooperative cancellation: bail out early if already aborted
    if (this.abortController.signal.aborted) {
      throw new Error('Flow execution cancelled')
    }


    // Generate unique execution ID for this node execution
    const executionId = crypto.randomUUID()
    console.log(`[Scheduler] ${nodeId} - Starting execution ${executionId}, isPull: ${isPull}, callerId: ${callerId}, pushedInputs:`, Object.keys(pushedInputs))

    const store = await this.getStore()
    store.feHandleNodeStart(nodeId)

    try {
      // Do NOT refresh from store here. The scheduler is the source of truth during execution.
      // The UI should reflect the scheduler's ExecutionContext, not the other way around.

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

      // Create NodeInputs with simple pull/has (no cross-input correlation)
      const inputs: NodeInputs = {
        pull: this.createPullFunction(nodeId),
        has: this.createHasFunction(nodeId)
      }

      // Execute the node function with new signature
      const nodeFunction = getNodeFunction(nodeConfig!)
      const result = await nodeFunction(flowAPI, contextIn, dataIn, inputs, config)

      // Update context tracking based on result
      if (result.context) {
        const resultContext = result.context
        const nodeType = (nodeConfig as any)?.nodeType || (nodeConfig as any)?.type
        const isPortalNode = nodeType === 'portalInput' || nodeType === 'portalOutput'

        if (!isPortalNode) {
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

            // Update UI tabs for isolated contexts; store handles not syncing to session
            store.feUpdateMainFlowContext(resultContext)
          }
        } else {
          // Portal nodes are transparent; do not sync context to store to avoid noise
          // We also skip internal main/isolated context updates as they should not change here
        }
      }

      const durationMs = Date.now() - startTime
      // Reduced logging
      store.feHandleNodeEnd(nodeId, durationMs)

      // Check for error status - stop execution if node failed
      if (result.status === 'error') {
        const errorMsg = result.error || 'Node execution failed'
        console.error(`[Scheduler] ${nodeId} - ERROR:`, errorMsg)
        store.feHandleError(`${nodeId}: ${errorMsg}`)
        throw new Error(errorMsg)
      }

      // PUSH PHASE: Call successors with our outputs
      // Skip this phase if node was executed via pull (caller is waiting for return value)
      if (!isPull) {
        // Note: Some nodes (like tools) are pull-only and don't push to successors
        const outgoingEdges = this.outgoingEdges.get(nodeId) || []

        // Filter out pull-only edges (tools edges should only be pulled, not pushed)
        const pushEdges = outgoingEdges.filter(edge => {
          // Tools edges are pull-only - they should not trigger execution
          if (edge.sourceOutput === 'tools') {
            return false
          }
          return true
        })

        // Debug: show normalized push edges for this node
        try {
          const dbgEdges = pushEdges.map(e => ({ target: e.target, sourceOutput: e.sourceOutput, targetInput: e.targetInput }))
          console.log(`[Scheduler] ${nodeId} - pushEdges:`, dbgEdges)
        } catch {}

        // Order successors so we start context recipients first, improving odds of dependent pulls succeeding
        const successorIds = Array.from(new Set(pushEdges.map(e => e.target)))
        successorIds.sort((a, b) => {
          const aHasContext = pushEdges.some(e => e.target === a && e.targetInput === 'context') ? 1 : 0
          const bHasContext = pushEdges.some(e => e.target === b && e.targetInput === 'context') ? 1 : 0
          return bHasContext - aHasContext
        })

        // Kick off all pushes in parallel so pulls can await in-flight producers
        const runnables: Promise<any>[] = []

        for (const successorId of successorIds) {
          // Collect all outputs going to this successor
          const pushedData: Record<string, any> = {}
          const considered: Array<{sourceOutput: string, targetInput: string, inResult: boolean}> = []

          for (const edge of pushEdges) {
            if (edge.target === successorId) {
              const sourceOutput = edge.sourceOutput
              const targetInput = edge.targetInput

              const inResult = sourceOutput in result
              considered.push({ sourceOutput, targetInput, inResult })

              if (inResult) {
                const value = (result as any)[sourceOutput]
                pushedData[targetInput] = value
              }
            }
          }


          try {
            console.log(`[Scheduler] ${nodeId} - collect for ${successorId}:`, considered)
          } catch {}

          // Only push to successor if we have data to push
          // This prevents calling successors with empty inputs (which would be treated as a pull)
          if (Object.keys(pushedData).length > 0) {
            const inFlight = this.inFlightExecutions.get(successorId)
            if (inFlight) {
              // Feed the currently in-flight execution; do not start a new one
              const current = this.pushedInputsByNode.get(successorId) || {}
              const merged = { ...current, ...pushedData }
              this.pushedInputsByNode.set(successorId, merged)
              try { this.resolveNodeInputWaiters(successorId, Object.keys(pushedData)) } catch {}
              const ctxDbg = merged.context ? { provider: merged.context.provider, model: merged.context.model, contextType: merged.context.contextType } : undefined
              console.log(`[Scheduler] ${nodeId} - Fed in-flight ${successorId} with:`, Object.keys(pushedData), ctxDbg)

            } else {
              // Coalesce pending pushes until it's safe to start (avoid ambiguous pulls)
              const curPending = this.pendingPushesByNode.get(successorId) || {}
              const merged = { ...curPending, ...pushedData }
              this.pendingPushesByNode.set(successorId, merged)
              // Resolve any waiters for inputs we just coalesced
              try { this.resolveNodeInputWaiters(successorId, Object.keys(pushedData)) } catch {}

              // Determine if any inputs have multiple incoming edges (ambiguous pull)
              // If so, require that those inputs be present in merged before starting
              const incoming = this.incomingEdges.get(successorId) || []
              const counts = new Map<string, number>()
              for (const e of incoming) {
                if (e.targetInput === 'tools') continue // tools are pull-only
                counts.set(e.targetInput, (counts.get(e.targetInput) || 0) + 1)
              }
              const missingAmbiguous = Array.from(counts.entries())
                .filter(([name, count]) => count > 1 && !(name in merged))
                .map(([name]) => name)

              // Require context to be present before starting if the successor has any context input edge
              const requiresContext = incoming.some(e => e.targetInput === 'context')
              const missingContext = requiresContext && !('context' in merged)

              if (missingAmbiguous.length === 0 && !missingContext) {
                // Safe to start now
                const initial = { ...merged }
                this.pendingPushesByNode.delete(successorId)
                const ctxDbg = initial.context ? { provider: initial.context.provider, model: initial.context.model, contextType: initial.context.contextType } : undefined
                console.log(`[Scheduler] ${nodeId} - Starting ${successorId} with initial pushed:`, Object.keys(initial), ctxDbg)
                runnables.push(this.executeNode(successorId, initial, nodeId))
              } else {
                const waitingFor = [...missingAmbiguous]
                if (missingContext) waitingFor.push('context')
                console.log(`[Scheduler] ${nodeId} - Deferring start of ${successorId}; waiting for:`, waitingFor)
              }
            }
          } else {
            console.log(`[Scheduler] ${nodeId} - NOT pushing to ${successorId} (no data)`)
          }
        }

        if (runnables.length) {
          // Fire-and-forget: do not await successors
          for (const p of runnables) {
            p.catch((err) => {
              console.error(`[Scheduler] ${nodeId} - Successor error:`, err)
              try { store.feHandleError(err?.message || String(err)) } catch {}
            })
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
    // Only log tool events for debugging
    if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'tool_error') {
      console.log(`[ExecutionEvent] ${event.nodeId} [${event.executionId}]: ${event.type}`)
      console.log(util.inspect(event, { depth: null, colors: false, maxArrayLength: 200 }))
    }

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
          store.feHandleToolEnd(
            event.tool.toolName,
            event.tool.toolCallId,
            event.nodeId,
            event.tool.toolResult
          )
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

      case 'rate_limit_wait':
        if (event.rateLimitWait) {
          store.feHandleRateLimitWait(
            event.nodeId,
            event.rateLimitWait.attempt,
            event.rateLimitWait.waitMs,
            event.rateLimitWait.reason,
            event.provider,
            event.model
          )
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
  private createPullFunction(
    nodeId: string
  ): (inputName: string) => Promise<any> {
    return async (inputName: string) => {
      console.log(`[Pull] ${nodeId} attempting to pull ${inputName}`)

      // First, check if this input was pushed to the current execution already (late push support)
      const livePushed = this.pushedInputsByNode.get(nodeId) || {}
      if (inputName in livePushed) {
        return (livePushed as any)[inputName]
      }

      const incomingEdges = this.incomingEdges.get(nodeId) || []
      const edgesForInput = incomingEdges.filter(e => e.targetInput === inputName)

      if (edgesForInput.length === 0) {
        console.error(`[Pull] ${nodeId} - No edge found for input '${inputName}'`)
        throw new Error(`No edge found for input '${inputName}' on node '${nodeId}'`)
      }

      if (edgesForInput.length > 1) {
        console.error(`[Pull] ${nodeId} - Invalid graph: multiple edges target input '${inputName}'`)
        throw new Error(`Invalid graph: multiple edges target input '${inputName}' on node '${nodeId}'`)
      }

      const edge = edgesForInput[0]
      console.log(`[Pull] ${nodeId} pulling ${inputName} from ${edge.source}.${edge.sourceOutput}`)

      // If source node is already executing, await its result instead of re-executing
      const inFlight = this.inFlightExecutions.get(edge.source)
      if (inFlight) {
        try {
          const res = await inFlight
          if (edge.sourceOutput in res) {
            return (res as any)[edge.sourceOutput]
          }
          return undefined
        } catch (e) {
          throw e
        }
      }



      // Execute source node to get the value (pull-only) — include any pending pushed inputs as initial
      const initialFromPending = { ...(this.pendingPushesByNode.get(edge.source) || {}) }
      if (Object.keys(initialFromPending).length > 0) {
        // Clear pending; execute will register pushed for this run
        this.pendingPushesByNode.delete(edge.source)
      }
      const sourceResult = await this.executeNode(edge.source, initialFromPending, nodeId, true)

      if (edge.sourceOutput in sourceResult) {
        return (sourceResult as any)[edge.sourceOutput]
      }

      return undefined
    }
  }

  /**
   * Create has function for a node
   * Checks if an input is available (pushed or can be pulled)
   */
  private createHasFunction(
    nodeId: string
  ): (inputName: string) => boolean {
    return (inputName: string) => {
      // If input was already pushed to the CURRENT execution, we have it
      const pushed = this.pushedInputsByNode.get(nodeId) || {}
      if (inputName in pushed) {
        return true
      }

      const incomingEdges = this.incomingEdges.get(nodeId) || []
      const edgesForInput = incomingEdges.filter(e => e.targetInput === inputName)

      // If exactly one incoming edge, this input can be pulled (if needed)
      if (edgesForInput.length === 1) {
        return true
      }

      // If multiple incoming edges, we cannot PULL (ambiguous), but PUSH is still allowed.
      // Do not treat this as a hard error in `has()` — simply report as "not available"
      // so nodes won't attempt to pull. If a predecessor PUSHES, it will still work.
      if (edgesForInput.length > 1) {
        return false
      }

      // No incoming edges — not available
      return false
    }
  }

  /**
   * Wait until a specific input is available (pushed or pending) for a node
   */
  private async waitForNodeInput(nodeId: string, inputName: string): Promise<void> {
    // Fast path: if already available, return immediately
    const pushed = this.pushedInputsByNode.get(nodeId) || {}
    const pending = this.pendingPushesByNode.get(nodeId) || {}
    if (inputName in pushed || inputName in pending) return

    return new Promise<void>((resolve) => {
      let byInput = this.inputWaiters.get(nodeId)
      if (!byInput) {
        byInput = new Map<string, Array<() => void>>()
        this.inputWaiters.set(nodeId, byInput)
      }
      const arr = byInput.get(inputName) || []
      arr.push(resolve)
      byInput.set(inputName, arr)
    })
  }

  /**
   * Resolve any waiters for inputs that just became available for a node
   */
  private resolveNodeInputWaiters(nodeId: string, availableKeys: string[]): void {
    const byInput = this.inputWaiters.get(nodeId)
    if (!byInput) return
    for (const key of availableKeys) {
      const arr = byInput.get(key)
      if (arr && arr.length) {
        for (const fn of arr) {
          try { fn() } catch {}
        }
        byInput.delete(key)
      }
    }
    if (byInput.size === 0) this.inputWaiters.delete(nodeId)
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
      // Prefer live config from main store (renderer-edited)
      const store = await this.getStore()
      const nodeFromStore = store?.feNodes?.find((n: any) => n.id === nodeId)
      const cfgFromStore = (nodeFromStore?.data as any)?.config
      if (cfgFromStore && Object.keys(cfgFromStore).length > 0) {
        return JSON.parse(JSON.stringify(cfgFromStore))
      }

      // Fallback to static FlowDefinition config (useful in unit tests or early boot)
      const nodeFromFlow = this.flowDef.nodes.find((n) => n.id === nodeId)
      const cfgFromFlow = nodeFromFlow?.config || {}
      return JSON.parse(JSON.stringify(cfgFromFlow))
    } catch (error: any) {
      console.error(`[FlowScheduler] Error getting config for ${nodeId}:`, error)
      // Final fallback
      const nodeFromFlow = this.flowDef.nodes.find((n) => n.id === nodeId)
      const cfgFromFlow = nodeFromFlow?.config || {}
      return JSON.parse(JSON.stringify(cfgFromFlow))
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

    // Find all Portal Output nodes with matching ID (support nodeType or legacy type)
    const portalOutputNodes = this.flowDef.nodes.filter((node: any) => {
      const t = node.nodeType || node.type
      return t === 'portalOutput' && node.config?.id === portalId
    })

    console.log(`[Scheduler] Found ${portalOutputNodes.length} portal output nodes with ID: ${portalId}`)

    // Execute each Portal Output node (push-trigger)
    for (const node of portalOutputNodes) {
      console.log(`[Scheduler] Triggering portal output node: ${node.id}`)
      await this.executeNode(node.id, {}, null, false)
    }
  }
}


