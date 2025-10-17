/**
 * Flow Scheduler - Pure Push/Pull Model
 *
 * Key concepts:
 * - PUSH: A node completes and calls its successors with outputs
 * - PULL: A node needs an input and executes the source node to get it
 * - Caching: Pull results are cached to prevent re-execution and cycles
 * - Nodes are async functions that await naturally (no pause/resume state machine)
 */

import type { WebContents } from 'electron'
import type {
  MainFlowContext,
  FlowDefinition,
  Edge,
  NodeOutput,
  FlowExecutionArgs,
} from './types'
import { getNodeFunction } from './nodes'

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

  // Pull cache: stores results from nodes executed via pull
  private pullCache = new Map<string, NodeOutput>()

  // Pull promises: prevents duplicate execution of same pull
  private pullPromises = new Map<string, Promise<NodeOutput>>()

  // User input promises: for nodes waiting for external input
  private userInputResolvers = new Map<string, (value: string) => void>()

  // Portal registry: stores data from portal input nodes by ID
  // Enables portal output nodes to retrieve data from matching input portals
  private portalRegistry = new Map<string, { context?: any; data?: any }>()

  // Multi-context tracking: main context + isolated contexts
  private mainContext: MainFlowContext
  private isolatedContexts = new Map<string, MainFlowContext>()

  // Current provider/model (can be updated mid-flow)
  private currentProvider: string
  private currentModel: string

  constructor(
    wc: WebContents | undefined,
    requestId: string,
    flowDef: FlowDefinition,
    args: FlowExecutionArgs
  ) {
    this._wc = wc
    this.requestId = requestId
    this.flowDef = flowDef
    // Initialize with provided values, but these will be refreshed from Zustand on each node execution
    this.currentProvider = args.provider || 'openai'
    this.currentModel = args.model || 'gpt-4'

    // Initialize main context
    this.mainContext = this.createDefaultContext()
    this.mainContext.contextType = 'main'

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
      // Find entry nodes (nodes with no incoming edges)
      const entryNodes = this.flowDef.nodes
        .filter(n => !this.incomingEdges.has(n.id))
        .map(n => n.id)

      // Execute each entry node (PULL with no pushed inputs)
      // This will trigger the flow execution, which should eventually reach a userInput node
      // and wait indefinitely for user input
      for (const nodeId of entryNodes) {
        await this.executeNode(nodeId, {}, null)
      }

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
   */
  private async executeNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null
  ): Promise<NodeOutput> {
    // Determine if this is a push or pull
    // Push = called by another node with outputs
    // Pull = called to satisfy a dependency (no caller or empty inputs)
    const isPush = callerId !== null && Object.keys(pushedInputs).length > 0

    // If we're already executing this node, handle carefully to avoid deadlock
    if (this.pullPromises.has(nodeId)) {
      // If this is a PUSH and the node is already executing, it means the node
      // is pulling from us. Don't await - just return immediately to avoid deadlock.
      // The pull will get our result when we return from this call.
      if (isPush) {
        console.log(`[Scheduler] ${nodeId} - Already executing (being pulled), ignoring push to avoid deadlock`)
        // Return a dummy result - the actual result will come from the pull
        return { status: 'success' } as NodeOutput
      }

      // If this is a PULL, await the existing promise
      console.log(`[Scheduler] ${nodeId} - Already executing, awaiting existing promise`)
      return await this.pullPromises.get(nodeId)!
    }

    // If we have a cached result from a previous pull, return it
    // (Only for pulls - pushes should always execute)
    if (!isPush && this.pullCache.has(nodeId)) {
      console.log(`[Scheduler] ${nodeId} - Returning cached result`)
      return this.pullCache.get(nodeId)!
    }

    const executionPromise = this.doExecuteNode(nodeId, pushedInputs, callerId, isPush)

    // Cache the promise (for both push and pull now)
    this.pullPromises.set(nodeId, executionPromise)

    const result = await executionPromise

    // Clean up promise cache
    this.pullPromises.delete(nodeId)

    // Cache result only for pulls
    if (!isPush) {
      this.pullCache.set(nodeId, result)
    }

    return result
  }
  
  /**
   * Actually execute the node (separated for promise caching)
   */
  private async doExecuteNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null,
    isPush: boolean
  ): Promise<NodeOutput> {
    const startTime = Date.now()

    const store = await this.getStore()
    store.feHandleNodeStart(nodeId)

    try {
      // Refresh provider/model from Zustand before executing
      // This ensures we always use the latest values from the UI
      await this.refreshProviderModel()

      // Start with pushed inputs
      const allInputs = { ...pushedInputs }

      // PULL PHASE: Get any missing inputs
      const incomingEdges = this.incomingEdges.get(nodeId) || []

      console.log(`[Scheduler] ${nodeId} - PULL phase:`, {
        incomingEdges: incomingEdges.length,
        pushedInputs: Object.keys(pushedInputs),
        callerId
      })

      for (const edge of incomingEdges) {
        const inputName = edge.targetInput

        // Skip if we already have this input (from push or previous pull)
        if (inputName in allInputs) {
          console.log(`[Scheduler] ${nodeId} - Skipping ${inputName} (already have it)`)
          continue
        }

        // Skip if this edge is from our caller (prevent immediate cycle)
        if (edge.source === callerId) {
          console.log(`[Scheduler] ${nodeId} - Skipping ${edge.source} (caller)`)
          continue
        }

        // PULL from source node
        console.log(`[Scheduler] ${nodeId} - Pulling ${inputName} from ${edge.source}.${edge.sourceOutput}`)
        const sourceResult = await this.executeNode(edge.source, {}, nodeId)

        // Extract the specific output from source
        const sourceOutput = edge.sourceOutput
        if (sourceOutput in sourceResult) {
          allInputs[inputName] = (sourceResult as any)[sourceOutput]
          console.log(`[Scheduler] ${nodeId} - Got ${inputName}:`, typeof allInputs[inputName])
        } else {
          console.log(`[Scheduler] ${nodeId} - Source ${edge.source} did not return ${sourceOutput}`)
        }
      }
      
      // Get node configuration from renderer (fresh on every execution)
      const nodeConfig = this.flowDef.nodes.find(n => n.id === nodeId)
      const config = await this.getNodeConfig(nodeId)

      // Separate inputs into context, data, and others
      // Context handling: if node has a context input, use it; otherwise use main context
      let contextIn: MainFlowContext
      if (allInputs.context) {
        // Node received a context from an edge - use it
        contextIn = allInputs.context
        console.log(`[Scheduler] ${nodeId} - Using context from edge:`, {
          contextId: contextIn.contextId,
          contextType: contextIn.contextType,
          provider: contextIn.provider,
          model: contextIn.model
        })
      } else {
        // No context input - use main context
        contextIn = this.mainContext
        console.log(`[Scheduler] ${nodeId} - Using main context:`, {
          contextId: contextIn.contextId,
          contextType: contextIn.contextType,
          provider: contextIn.provider,
          model: contextIn.model
        })
      }

      const dataIn = allInputs.data
      const otherInputs: Record<string, any> = {}
      for (const [key, value] of Object.entries(allInputs)) {
        if (key !== 'context' && key !== 'data') {
          otherInputs[key] = value
        }
      }

      // Inject current provider/model (supports mid-flow switching)
      // This ensures that if the user changed provider/model in the UI,
      // the next node will use the updated values
      contextIn.provider = this.currentProvider
      contextIn.model = this.currentModel

      // Add nodeId to config for nodes that need it
      const configWithNodeId = { ...config, _nodeId: nodeId }

      // Execute the node function
      const nodeFunction = getNodeFunction(nodeConfig!)
      const result = await nodeFunction(contextIn, dataIn, otherInputs, configWithNodeId)

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
          store.feUpdateMainFlowContext(this.mainContext)
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

      // Cache result if this was a pull
      if (!isPush) {
        this.pullCache.set(nodeId, result)
      }

      const durationMs = Date.now() - startTime
      store.feHandleNodeEnd(nodeId, durationMs)

      // Check for error status - stop execution if node failed
      if (result.status === 'error') {
        const errorMsg = result.error || 'Node execution failed'
        console.error(`[Scheduler] ${nodeId} - ERROR:`, errorMsg)
        store.feHandleError(`${nodeId}: ${errorMsg}`)
        throw new Error(errorMsg)
      }

      // PUSH PHASE: Call successors with our outputs
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
   * Create default main flow context
   */
  private createDefaultContext(): MainFlowContext {
    return {
      contextId: 'main',
      contextType: 'main', // Mark as main context for purple color
      provider: this.currentProvider,
      model: this.currentModel,
      messageHistory: [],
      systemInstructions: undefined
    }
  }

  /**
   * Update provider/model for the flow (mid-flow switching)
   * This updates the current provider/model that will be injected into contexts
   * NOTE: This is now mostly redundant since we refresh from Zustand before each node execution,
   * but kept for backwards compatibility with resume flow
   */
  updateProviderModel(provider?: string, model?: string): void {
    if (provider) {
      this.currentProvider = provider
    }
    if (model) {
      this.currentModel = model
    }
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
   * Refresh provider/model from main store
   * This ensures we always use the latest values from the UI
   */
  private async refreshProviderModel(): Promise<void> {
    try {
      // Read directly from main store (no IPC needed!)
      const store = await this.getStore()
      const provider = store.selectedProvider
      const model = store.selectedModel

      if (provider !== this.currentProvider || model !== this.currentModel) {
        this.currentProvider = provider
        this.currentModel = model
      }
    } catch (error: any) {
      console.error('[FlowScheduler] Error refreshing provider/model:', error)
    }
  }

  /**
   * Wait for user input (called by userInput node)
   */
  async waitForUserInput(nodeId: string): Promise<string> {
    const store = await this.getStore()
    store.feHandleWaitingForInput(nodeId, this.requestId)

    // Create a promise that will be resolved when resumeWithInput is called
    const userInput = await new Promise<string>((resolve) => {
      this.userInputResolvers.set(nodeId, resolve)
    })

    this.userInputResolvers.delete(nodeId)

    return userInput
  }

  /**
   * Resolve a waiting user input promise
   * This doesn't "resume" the flow - the flow is already running, just awaiting this promise
   */
  resolveUserInput(nodeId: string, userInput: string): void {
    const resolver = this.userInputResolvers.get(nodeId)
    if (resolver) {
      resolver(userInput)
    }
  }

  /**
   * Store data in portal registry (called by portalInput nodes)
   */
  setPortalData(portalId: string, context?: any, data?: any): void {
    this.portalRegistry.set(portalId, { context, data })
  }

  /**
   * Retrieve data from portal registry (called by portalOutput nodes)
   */
  getPortalData(portalId: string): { context?: any; data?: any } | undefined {
    const data = this.portalRegistry.get(portalId)
    return data
  }
}


