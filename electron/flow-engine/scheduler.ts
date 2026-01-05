/**
 * Flow Scheduler - Node-Controlled Execution
 *
 * Architecture:
 * - Nodes are autonomous functions that control their own execution
 * - Nodes decide when to pull inputs (lazy evaluation)
 * - Nodes decide when they're "done" (different logic per node type)
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
  MessagePart,
} from './types'
import type { ContextBinding } from './contextRegistry'
import { buildFlowGraph } from './flow-graph'
import { FlowNodeIoCoordinator } from './node-io-coordinator'
import { createExecutionEventRouter, type ExecutionEventRouter } from './execution-event-router'
import { createFlowApiFactory, type FlowApiFactory } from './flow-api-factory'
import { emitFlowEvent } from './events'
import { ContextLifecycleManager } from './context-lifecycle-manager'
import { FlowNodeRunner } from './flow-node-runner'
import { isCancellationError } from './cancellation'
import { getFlowContextsService, getFlowGraphService, getSessionService } from '../services/index.js'

const DEBUG = process.env.HF_SCHEDULER_DEBUG === '1'

export class FlowScheduler {
  // Graph structure
  private flowDef: FlowDefinition

  private incomingEdges: Map<string, Edge[]>
  private outgoingEdges: Map<string, Edge[]>

  // Workspace scoping (absolute path)
  private workspaceId: string | undefined
  private sessionId: string | undefined


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
  private userInputResolvers = new Map<string, (value: string | MessagePart[]) => void>()

  // Multi-context tracking: main context + isolated contexts
  private contextLifecycle: ContextLifecycleManager
  private nodeRunner!: FlowNodeRunner

  private ioCoordinator!: FlowNodeIoCoordinator
  private executionEventRouter!: ExecutionEventRouter
  private flowApiFactory!: FlowApiFactory

  // Track active/executing nodes and paused state for status snapshots
  private activeNodeIds = new Set<string>()
  private pausedNodeId: string | null = null

  // Portal data registry (for portal nodes)
  private portalRegistry = new Map<string, { context?: MainFlowContext; data?: any }>()

  constructor(
    wc: WebContents | undefined,
    requestId: string,
    flowDef: FlowDefinition,
    args: FlowExecutionArgs
  ) {
    this._wc = wc
    this.requestId = requestId
    this.flowDef = flowDef

    const graph = buildFlowGraph(flowDef)
    this.incomingEdges = graph.incomingEdges
    this.outgoingEdges = graph.outgoingEdges

    // Workspace scoping for tools/events

    // Session scoping for events
    this.sessionId = (args as any)?.sessionId
    console.log('[FlowScheduler] Constructor - sessionId:', this.sessionId, 'workspaceId:', (args as any)?.workspaceId)

    this.workspaceId = (args as any)?.workspaceId

    // Initialize main context from session context (single source of truth)
    // Use requestId as contextId so terminal tools bind to the session's PTY
    // If no session context provided, create default
    let initialContext: MainFlowContext
    if (args.initialContext) {
      const safeHistory = Array.isArray(args.initialContext.messageHistory)
        ? args.initialContext.messageHistory
        : []

      initialContext = {
        contextId: requestId,
        contextType: 'main',
        provider: args.initialContext.provider,
        model: args.initialContext.model,
        systemInstructions: args.initialContext.systemInstructions,
        messageHistory: safeHistory
      }
      if (DEBUG) console.log('[Scheduler] Initialized from session context:', {
        contextId: initialContext.contextId,
        provider: initialContext.provider,
        model: initialContext.model,
        messageCount: initialContext.messageHistory.length
      })
    } else {
      // Fallback: create default context (should rarely happen)
      initialContext = {
        contextId: requestId,
        contextType: 'main',
        provider: 'openai',
        model: 'gpt-4o',
        messageHistory: [],
        systemInstructions: undefined
      }
      if (DEBUG) console.warn('[Scheduler] No session context provided, using defaults')
    }

    this.contextLifecycle = new ContextLifecycleManager({
      initialContext,
      requestId: this.requestId,
      workspaceId: this.workspaceId,
      flowContextsService: getFlowContextsService(),
    })

    this.executionEventRouter = createExecutionEventRouter({
      requestId: this.requestId,
      sessionId: this.sessionId,
      abortSignal: this.abortController.signal
    })

    this.ioCoordinator = new FlowNodeIoCoordinator(
      (nodeId) => this.incomingEdges.get(nodeId) || [],
      (nodeId, inputs, callerId, isPull) => this.executeNode(nodeId, inputs, callerId, isPull)
    )

    this.flowApiFactory = createFlowApiFactory({
      requestId: this.requestId,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      abortController: this.abortController,
      contextRegistry: this.contextLifecycle.getContextRegistry(),
      portalRegistry: this.portalRegistry,
      userInputResolvers: this.userInputResolvers,
      executionEventRouter: this.executionEventRouter,
      triggerPortalOutputs: (portalId) => this.triggerPortalOutputs(portalId),
      setPausedNodeId: (nodeId) => { this.pausedNodeId = nodeId },
      createIsolatedContext: (options, activeBinding) =>
        this.contextLifecycle.createIsolatedContext(options, activeBinding),
      releaseContext: (contextId) => this.contextLifecycle.releaseContext(contextId)
    })

    this.nodeRunner = new FlowNodeRunner({
      flowDefinition: this.flowDef,
      flowApiFactory: this.flowApiFactory,
      ioCoordinator: this.ioCoordinator,
      contextLifecycle: this.contextLifecycle,
      abortSignal: this.abortController.signal,
      requestId: this.requestId,
      sessionId: this.sessionId,
      getNodeConfig: (nodeId) => this.getNodeConfig(nodeId),
      flushToSession: () => this.flushToSession(),
      onNodeStart: (nodeId) => {
        try { this.activeNodeIds.add(nodeId) } catch {}
      },
      onNodeEnd: (nodeId) => {
        try { this.activeNodeIds.delete(nodeId) } catch {}
      },
    })


  }

  public getSessionId(): string | undefined {
    return this.sessionId
  }

  public getWorkspaceId(): string | undefined {
    return this.workspaceId
  }

  /**
   * Flush the current messageHistory back to the session
   * This ensures the session persists the conversation state when the scheduler stops
   */
  public async flushToSession(): Promise<void> {
    try {
      const sessionService = getSessionService()
      const workspaceId = this.workspaceId
      const mainContext = this.mainContext

      if (!workspaceId) {
        console.warn('[Scheduler.flushToSession] No workspaceId, skipping flush')
        return
      }

      const currentSessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (currentSessionId !== this.sessionId) {
        console.warn('[Scheduler.flushToSession] Session changed, skipping flush', {
          schedulerSessionId: this.sessionId,
          currentSessionId
        })
        return
      }

      if (workspaceId && this.sessionId) {
        sessionService.updateContextFor({
          workspaceId,
          sessionId: this.sessionId,
          messageHistory: mainContext.messageHistory,
          provider: mainContext.provider,
          model: mainContext.model,
          systemInstructions: mainContext.systemInstructions
        })
      } else {
        console.warn('[Scheduler.flushToSession] Missing workspaceId or sessionId, cannot flush')
      }
    } catch (e) {
      console.error('[Scheduler.flushToSession] Error flushing to session:', e)
    }
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

    // Clear user input resolvers - the abort signal will reject the promises
    try {
      this.userInputResolvers.clear()
    } catch {}

    // Flush final state to session before stopping and then clear context state
    // Fire and forget - don't block cancellation
    void this.flushToSession().finally(() => {
      this.contextLifecycle.clearContextState()
    })
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
      // Check both top-level nodeType/type and data.nodeType (ReactFlow format)
      let entryNode = this.flowDef.nodes.find((n: any) =>
        (n.nodeType === 'defaultContextStart') ||
        (n.type === 'defaultContextStart') ||
        (n.data?.nodeType === 'defaultContextStart')
      )

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

      // Execute the entry node with the scheduler's main context.
      // Provider/model for main context come from the session's currentContext (initialContext)
      // and may be updated mid-flow via updateProviderModel. We intentionally do NOT
      // override them here from the global provider slice so that the per-session
      // model selector is the single source of truth for main flows.
      await this.executeNode(entryNode.id, { context: this.mainBinding.ref.current }, null)

      // Don't return - wait indefinitely for user input
      // The flow should only complete if explicitly cancelled or if an error occurs
      return new Promise(() => {
        // This promise never resolves - the flow waits indefinitely
        // It can only be cancelled by external means (e.g., user cancels the flow)
      })
    } catch (e: any) {
      const error = e?.message || String(e)
      if (isCancellationError(e)) {
        console.log('[FlowScheduler] Cancelled')
        await this.flushToSession()
        this.contextLifecycle.clearContextState()
        return { ok: true }
      }
      console.error('[FlowScheduler] Error:', error)
      try { emitFlowEvent(this.requestId, { type: 'error', error, sessionId: this.sessionId }) } catch {}
      await this.flushToSession()
      this.contextLifecycle.clearContextState()
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
    if (DEBUG) console.log(`[Scheduler] ${nodeId} - Executing node`, {
      pushedInputs: Object.keys(pushedInputs),
      callerId,
      isPull
    })

    const promise = this.nodeRunner.run({ nodeId, pushedInputs, callerId, isPull })
    this.ioCoordinator.registerExecution(nodeId, pushedInputs, promise)

    if (isPull) {
      return promise
    }

    return promise.then((result) => {
      this.pushSuccessors(nodeId, result)
      return result
    })
  }

  private pushSuccessors(nodeId: string, result: NodeOutput): void {
    const outgoingEdges = this.outgoingEdges.get(nodeId) || []
    const pushEdges = outgoingEdges.filter(edge => edge.sourceOutput !== 'tools')

    if (pushEdges.length === 0) {
      if (DEBUG) console.log(`[Scheduler] ${nodeId} - No push edges, nothing to propagate`)
      return
    }

    if (DEBUG) {
      try {
        const dbgEdges = pushEdges.map(e => ({ target: e.target, sourceOutput: e.sourceOutput, targetInput: e.targetInput }))
        console.log(`[Scheduler] ${nodeId} - pushEdges:`, dbgEdges)
      } catch {}
    }

    const successorIds = Array.from(new Set(pushEdges.map(e => e.target)))
    successorIds.sort((a, b) => {
      const aHasContext = pushEdges.some(e => e.target === a && e.targetInput === 'context') ? 1 : 0
      const bHasContext = pushEdges.some(e => e.target === b && e.targetInput === 'context') ? 1 : 0
      return bHasContext - aHasContext
    })

    const runnables: Array<{ id: string; promise: Promise<NodeOutput | undefined> }> = []

    for (const successorId of successorIds) {
      const pushedData: Record<string, any> = {}
      const considered: Array<{ sourceOutput: string; targetInput: string; inResult: boolean }> = []
      let needsContext = false

      for (const edge of pushEdges) {
        if (edge.target !== successorId) continue
        const sourceOutput = edge.sourceOutput
        const targetInput = edge.targetInput
        if (targetInput === 'context') {
          needsContext = true
        }

        const inResult = sourceOutput in result
        considered.push({ sourceOutput, targetInput, inResult })

        if (inResult) {
          const value = (result as any)[sourceOutput]
          pushedData[targetInput] = value
        }
      }

      if (needsContext && !('context' in pushedData)) {
        pushedData.context = (result as any).context || this.mainBinding.ref.current
      }

      if (DEBUG) {
        try {
          console.log(`[Scheduler] ${nodeId} - collect for ${successorId}:`, considered)
        } catch {}
      }

      if (pushedData.context && (pushedData.context.contextType === 'main' || !pushedData.context.contextType)) {
        const mainContext = this.mainContext
        if (mainContext.provider !== pushedData.context.provider || mainContext.model !== pushedData.context.model) {
          if (DEBUG) console.log(`[Scheduler] ${nodeId} - Updating pushed context provider/model from mainContext:`, {
            old: { provider: pushedData.context.provider, model: pushedData.context.model },
            new: { provider: mainContext.provider, model: mainContext.model }
          })
          pushedData.context = {
            ...pushedData.context,
            provider: mainContext.provider,
            model: mainContext.model
          }
        }
      }

      if (Object.keys(pushedData).length === 0) {
        if (DEBUG) console.log(`[Scheduler] ${nodeId} - NOT pushing to ${successorId} (no data)`)
        continue
      }

      const inFlight = this.ioCoordinator.getInFlightExecution(successorId)
      if (inFlight) {
        const merged = this.ioCoordinator.mergeIntoLiveInputs(successorId, pushedData)
        if (DEBUG) {
          const ctxDbg = merged.context ? { provider: merged.context.provider, model: merged.context.model, contextType: merged.context.contextType } : undefined
          console.log(`[Scheduler] ${nodeId} - Fed in-flight ${successorId} with:`, Object.keys(pushedData), ctxDbg)
        }
        continue
      }

      const queueResult = this.ioCoordinator.queuePendingInputs(successorId, pushedData)
      if (queueResult.type === 'ready') {
        const initial = { ...queueResult.initialInputs }
        if (DEBUG) {
          const ctxDbg = initial.context ? { provider: initial.context.provider, model: initial.context.model, contextType: initial.context.contextType } : undefined
          console.log(`[Scheduler] ${nodeId} - Starting ${successorId} with initial pushed:`, Object.keys(initial), ctxDbg)
        }
        runnables.push({ id: successorId, promise: this.executeNode(successorId, initial, nodeId) })
      } else {
        if (DEBUG) console.log(`[Scheduler] ${nodeId} - Deferring start of ${successorId}; waiting for:`, queueResult.waitingFor)
      }
    }

    for (const runnable of runnables) {
      const succId = runnable.id
      runnable.promise = runnable.promise.catch((err) => {
        if (isCancellationError(err)) {
          if (DEBUG) console.log(`[Scheduler] ${nodeId} - Successor ${succId} cancelled`)
          return undefined
        }
        console.error(`[Scheduler] ${nodeId} - Successor ${succId} error:`, err)
        return undefined
      })
    }
  }

  private get mainBinding(): ContextBinding {
    return this.contextLifecycle.getMainBinding()
  }

  private get mainContext(): MainFlowContext {
    return this.contextLifecycle.getMainContext()
  }



  /**
   * Update provider/model for the main context (mid-flow switching)
   * This updates the main context to use new provider/model from the UI
   */
  updateProviderModel(provider?: string, model?: string): void {
    // 1. Update internal state
    if (provider) {
      this.mainContext.provider = provider
    }
    if (model) {
      this.mainContext.model = model
    }
    
    // 2. Propagate to lifecycle manager (which updates the context registry)
    this.contextLifecycle.updateProviderModel(provider, model)

    if (DEBUG) console.log('[Scheduler] Updated main context provider/model:', {
      provider: this.mainContext.provider,
      model: this.mainContext.model
    })
  }

  /**
   * Get current node configuration from FlowGraphService
   * This fetches the config fresh from the service on every call
   */
  private async getNodeConfig(nodeId: string): Promise<Record<string, any>> {
    try {
      // Prefer live config from FlowGraphService (renderer-edited)
      const flowGraphService = getFlowGraphService()

      // Get nodes for this workspace
      let nodes: any[] = []
      if (this.workspaceId) {
        nodes = flowGraphService.getNodes({ workspaceId: this.workspaceId })
      }

      const nodeFromService = nodes?.find((n: any) => n.id === nodeId)
      const cfgFromService = (nodeFromService?.data as any)?.config
      if (cfgFromService && Object.keys(cfgFromService).length > 0) {
        return JSON.parse(JSON.stringify(cfgFromService))
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
  resolveUserInput(nodeId: string, userInput: string | MessagePart[]): void {
    console.log('[scheduler.resolveUserInput] Attempting to resolve nodeId:', nodeId)
    console.log('[scheduler.resolveUserInput] Available resolvers:', Array.from(this.userInputResolvers.keys()))

    const resolver = this.userInputResolvers.get(nodeId)
    if (resolver) {
      console.log('[scheduler.resolveUserInput] Found resolver, resolving with input')
      resolver(userInput)
      // Clear paused state after input is provided
      try { this.pausedNodeId = null } catch {}
    } else {
      console.error('[scheduler.resolveUserInput] No resolver found for nodeId:', nodeId)
    }
  }

  /**
   * Resolve ANY waiting user input promise (used when we don't know the exact nodeId)
   * This is called by resumeFlow when the user submits input
   */
  resolveAnyWaitingUserInput(userInput: string | MessagePart[]): void {
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
      // Clear paused state after input is provided
      try { this.pausedNodeId = null } catch {}
    }
  }

  /**
   * Trigger all Portal Output nodes with matching ID
   * Called by Portal Input nodes after storing data
   */
  async triggerPortalOutputs(portalId: string): Promise<void> {
    if (DEBUG) console.log(`[Scheduler] Triggering portal outputs for ID: ${portalId}`)

    // Find all Portal Output nodes with matching ID (support nodeType in multiple locations)
    const portalOutputNodes = this.flowDef.nodes.filter((node: any) => {
      const t = node.nodeType || node.data?.nodeType || node.type
      const configId = node.config?.id || node.data?.config?.id
      return t === 'portalOutput' && configId === portalId
    })

    if (DEBUG) console.log(`[Scheduler] Found ${portalOutputNodes.length} portal output nodes with ID: ${portalId}`)

    // Execute each Portal Output node (push-trigger)
    for (const node of portalOutputNodes) {
      if (DEBUG) console.log(`[Scheduler] Triggering portal output node: ${node.id}`)
      await this.executeNode(node.id, {}, null, false)
    }
  }

  /**
   * Snapshot current scheduler state for UI seeding on reconnect
   */
  public getSnapshot(): { requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null } {
    const aborted = this.abortController?.signal?.aborted === true
    const hasWaiting = this.userInputResolvers.size > 0 || !!this.pausedNodeId
    const status: 'running' | 'waitingForInput' | 'stopped' = aborted ? 'stopped' : (hasWaiting ? 'waitingForInput' : 'running')
    return {
      requestId: this.requestId,
      status,
      activeNodeIds: Array.from(this.activeNodeIds),
      pausedNodeId: this.pausedNodeId || null,
    }
  }

}
