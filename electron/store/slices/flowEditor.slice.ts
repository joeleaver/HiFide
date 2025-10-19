import type { StateCreator } from 'zustand'
import type { Edge, Node, NodeChange, XYPosition } from 'reactflow'
import type { PricingConfig } from '../types'
import { initializeFlowProfiles, listFlowTemplates, loadFlowTemplate, saveFlowProfile, deleteFlowProfile, isSystemTemplate, loadSystemTemplates, type FlowTemplate, type FlowProfile } from '../../services/flowProfiles'
import type { MainFlowContext } from '../../ipc/flows-v2/types'
import { loadWorkspaceSettings, saveWorkspaceSettings } from '../../ipc/workspace'
import { reactFlowToFlowDefinition } from '../../services/flowConversion'

// Flow runtime event type (mirrors renderer usage)
export type FlowEvent = {
  requestId: string
  type: 'nodeStart' | 'nodeEnd' | 'io' | 'done' | 'error' | 'waitingForInput' | 'chunk' | 'toolStart' | 'toolEnd' | 'toolError' | 'intentDetected' | 'tokenUsage'
  nodeId?: string
  data?: any
  error?: string
  durationMs?: number
  timestamp: number
  text?: string  // For chunk events
  toolName?: string  // For tool events
  callId?: string  // For tool events
  intent?: string  // For intentDetected events
  provider?: string  // For tokenUsage events
  model?: string  // For tokenUsage events
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }  // For tokenUsage events
}

// Flow execution status
export type FlowStatus = 'stopped' | 'running' | 'waitingForInput'

// Node execution state (separate from layout)
export interface NodeExecutionState {
  status?: 'executing' | 'completed' | 'ok' | 'warn' | 'blocked' | 'masked'
  cacheHit?: boolean
  durationMs?: number
  costUSD?: number
  detectedIntent?: string
  style?: {
    border?: string
    boxShadow?: string
  }
}

// Slice interface
export interface FlowEditorSlice {
  // Graph state
  feNodes: Node[]
  feEdges: Edge[]
  feNodePositions: Record<string, XYPosition>
  feNodeExecutionState: Record<string, NodeExecutionState>  // Execution state separate from layout (plain object for IPC serialization)

  // Main flow context (ephemeral, only exists during flow execution)
  feMainFlowContext: MainFlowContext | null

  // Isolated contexts (ephemeral, only exist during flow execution)
  // Map of contextId -> MainFlowContext for all isolated contexts created by newContext nodes
  feIsolatedContexts: Record<string, MainFlowContext>

  // Selection/UI state
  feSelectedNodeId: string | null

  // Run/watch state
  feRequestId: string | null
  feStatus: FlowStatus
  fePausedNode: string | null
  feEvents: FlowEvent[]
  feLog: string
  feLastExportMsg: string
  feExportResult: { success: boolean; path?: string; error?: string; canceled?: boolean } | null
  feImportResult: { success: boolean; name?: string; error?: string; canceled?: boolean } | null
  feStreamingText: string  // Streaming text from chat nodes
  feActiveTools: Set<string>  // Currently executing tools (tool names)

  // Inputs/config
  feInput: string
  feResolvedModel: string | null
  feErrorDetectPatterns: string
  feRetryAttempts: number
  feRetryBackoffMs: number
  feCacheEnabled: boolean

  // Global policy toggles
  feRedactorEnabled: boolean
  feRuleEmails: boolean
  feRuleApiKeys: boolean
  feRuleAwsKeys: boolean
  feRuleNumbers16: boolean
  feBudgetUSD: string
  feBudgetBlock: boolean
  feErrorDetectEnabled: boolean
  feErrorDetectBlock: boolean

  // Template management state
  feCurrentProfile: string
  feAvailableTemplates: FlowTemplate[]
  feTemplatesLoaded: boolean
  feSelectedTemplate: string
  feHasUnsavedChanges: boolean
  feSaveAsModalOpen: boolean
  feNewProfileName: string
  feLoadTemplateModalOpen: boolean
  feLastSavedState: string | null  // JSON snapshot of last saved nodes/edges

  // Actions
  initFlowEditor: () => Promise<void>
  feLoadTemplates: () => Promise<void>
  feLoadTemplate: (templateId: string) => Promise<void>
  feSaveCurrentProfile: () => Promise<void>
  feStartPeriodicSave: () => void
  feStopPeriodicSave: () => void
  feSaveAsProfile: (name: string) => Promise<void>
  feDeleteProfile: (name: string) => Promise<void>
  feExportFlow: () => Promise<void>
  feClearExportResult: () => void
  feImportFlow: () => Promise<void>
  feClearImportResult: () => void
  feSetSelectedTemplate: (id: string) => void
  feSetSaveAsModalOpen: (open: boolean) => void
  feSetNewProfileName: (name: string) => void
  feSetLoadTemplateModalOpen: (open: boolean) => void
  feSetNodes: (nodesOrUpdater: Node[] | ((current: Node[]) => Node[])) => void
  feSetEdges: (edgesOrUpdater: Edge[] | ((current: Edge[]) => Edge[])) => void
  feApplyNodeChanges: (changes: NodeChange[]) => void
  feUpdateNodePosition: (params: { id: string; pos: XYPosition }) => void
  feAddNode: (params: { kind: string; pos: XYPosition; label?: string }) => void
  feSetSelectedNodeId: (id: string | null) => void
  feSetNodeLabel: (params: { id: string; label: string }) => void
  fePatchNodeConfig: (params: { id: string; patch: Record<string, any> }) => void

  feSetInput: (text: string) => void
  feSetPatterns: (text: string) => void
  feSetRetryAttempts: (n: number) => void
  feSetRetryBackoffMs: (ms: number) => void
  feSetCacheEnabled: (v: boolean) => void

  feSetRedactorEnabled: (v: boolean) => void
  feSetRuleEmails: (v: boolean) => void
  feSetRuleApiKeys: (v: boolean) => void
  feSetRuleAwsKeys: (v: boolean) => void
  feSetRuleNumbers16: (v: boolean) => void
  feSetBudgetUSD: (usd: string) => void
  feSetBudgetBlock: (v: boolean) => void
  feSetErrorDetectEnabled: (v: boolean) => void
  feSetErrorDetectBlock: (v: boolean) => void

  feComputeResolvedModel: () => void

  feClearLogs: () => void
  flowInit: () => Promise<void>
  feResumeFromState: (requestId: string) => Promise<void>
  feStop: () => Promise<void>
  feResume: (userInput?: string) => Promise<void>
  feExportTrace: () => Promise<void>

  // Flow event handlers - called by scheduler to update UI state
  feHandleNodeStart: (nodeId: string) => void
  feHandleNodeEnd: (nodeId: string, durationMs?: number) => void
  feUpdateMainFlowContext: (context: MainFlowContext) => void
  feHandleIO: (nodeId: string, data: string) => void
  feHandleChunk: (text: string, nodeId?: string, provider?: string, model?: string) => void
  feHandleToolStart: (toolName: string, nodeId?: string, toolArgs?: any, callId?: string, provider?: string, model?: string) => void
  feHandleToolEnd: (toolName: string, callId?: string, nodeId?: string) => void
  feHandleToolError: (toolName: string, error: string, callId?: string, nodeId?: string) => void
  feHandleIntentDetected: (nodeId: string, intent: string, provider?: string, model?: string) => void
  feHandleTokenUsage: (provider: string, model: string, usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  feHandleWaitingForInput: (nodeId: string, requestId: string) => void
  feHandleDone: () => void
  feHandleError: (error: string) => void

  // User input management (for userInput node)
  feWaitForUserInput: (nodeId: string) => Promise<string>
  feResolveUserInput: (nodeId: string, userInput: string) => void

  // Portal registry (for portal nodes)
  feSetPortalData: (portalId: string, context?: any, data?: any) => void
  feGetPortalData: (portalId: string) => { context?: any; data?: any } | undefined
  feClearPortalData: (portalId: string) => void
}

// NOTE: Default flow is now loaded from src/profiles/default-flow.json
// This ensures a single source of truth for the default flow configuration

// Debounce helper
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export const createFlowEditorSlice: StateCreator<FlowEditorSlice> = (set, get, store) => ({
  // Initial state - will be populated by initializeFlowProfiles()
  feNodes: [],
  feEdges: [],
  feNodePositions: {},
  feNodeExecutionState: {},
  feMainFlowContext: null,
  feIsolatedContexts: {},

  feSelectedNodeId: null,

  feRequestId: null,
  feStatus: 'stopped',
  fePausedNode: null,
  feEvents: [],
  feLog: '',
  feLastExportMsg: '',
  feExportResult: null,
  feImportResult: null,
  feStreamingText: '',
  feActiveTools: new Set(),

  feInput: 'Say hello to the user and introduce yourself briefly.',
  feResolvedModel: null,
  feErrorDetectPatterns: '',
  feRetryAttempts: 1,
  feRetryBackoffMs: 0,
  feCacheEnabled: false,

  feRedactorEnabled: true,
  feRuleEmails: true,
  feRuleApiKeys: true,
  feRuleAwsKeys: true,
  feRuleNumbers16: false,
  feBudgetUSD: '',
  feBudgetBlock: true,
  feErrorDetectEnabled: true,
  feErrorDetectBlock: false,

  // Template management initial state
  feCurrentProfile: '',
  feAvailableTemplates: [],
  feTemplatesLoaded: false,
  feSelectedTemplate: 'default',
  feHasUnsavedChanges: false,
  feSaveAsModalOpen: false,
  feNewProfileName: '',
  feLoadTemplateModalOpen: false,
  feLastSavedState: null,

  // ----- Actions -----

  initFlowEditor: async () => {
    // Load available templates
    await get().feLoadTemplates()

    // Start periodic save for user flows
    get().feStartPeriodicSave()

    // Check if there's a current session - if so, let session initialization handle flow loading
    const state = get() as any
    const hasSession = state.currentId && state.sessions?.find((s: any) => s.id === state.currentId)

    if (hasSession) {
      return
    }

    // No session - try to load last used flow for this workspace (main process only)
    let loadedFromWorkspace = false
    try {
      // Only run in main process (check for process.type)
      if (typeof process !== 'undefined' && !process.type) {
        // We're in the main process
        const settings = await loadWorkspaceSettings()

        if (settings?.lastUsedFlow) {
          const lastFlow = settings.lastUsedFlow

          const profile = await loadFlowTemplate(lastFlow)
          if (profile && profile.nodes && profile.edges) {
            const isSystem = await isSystemTemplate(lastFlow)
            set({
              feNodes: profile.nodes,
              feEdges: profile.edges,
              feCurrentProfile: isSystem ? '' : lastFlow,
              feSelectedTemplate: lastFlow,  // Set selector to show loaded flow
            })
            loadedFromWorkspace = true
            // Flow will be initialized by session initialization
          }
        }
      }
    } catch (e) {
      console.error('[flowEditor] Failed to load last used flow:', e)
    }

    // Fall back to default flow if no workspace flow was loaded
    if (!loadedFromWorkspace) {
      try {
        const profile = await initializeFlowProfiles()

        if (profile && profile.nodes && profile.edges) {
          set({
            feNodes: profile.nodes,
            feEdges: profile.edges,
            feSelectedTemplate: 'default',  // Set selector to show default flow
          })
          // Flow will be initialized by session initialization
        } else {
        }
      } catch (error) {
        console.error('Failed to load flow profile:', error)
      }
    }

    // Load persisted state (main process - could load from file if needed)
    // For now, skip this in main process - state is already in the store
    try {
      // TODO: Load flow editor state from workspace settings if needed
      const patch: Partial<FlowEditorSlice> = {}
      // Skip for now - this section is a placeholder for future workspace settings loading
      const st: any = {}
      if (typeof st.ruleAwsKeys === 'boolean') patch.feRuleAwsKeys = st.ruleAwsKeys
      if (typeof st.ruleNumbers16 === 'boolean') patch.feRuleNumbers16 = st.ruleNumbers16
      if (typeof st.errorDetectEnabled === 'boolean') patch.feErrorDetectEnabled = st.errorDetectEnabled
      if (typeof st.errorDetectBlock === 'boolean') patch.feErrorDetectBlock = st.errorDetectBlock
      if (typeof st.budgetUSD === 'string') patch.feBudgetUSD = st.budgetUSD
      if (typeof st.budgetBlock === 'boolean') patch.feBudgetBlock = st.budgetBlock
      if (typeof st.retryAttempts === 'number') patch.feRetryAttempts = st.retryAttempts
      if (typeof st.retryBackoffMs === 'number') patch.feRetryBackoffMs = st.retryBackoffMs
      if (typeof st.cacheEnabled === 'boolean') patch.feCacheEnabled = st.cacheEnabled
      if (typeof st.errorDetectPatterns === 'string') patch.feErrorDetectPatterns = st.errorDetectPatterns
      if (st.nodePositions && typeof st.nodePositions === 'object') {
        patch.feNodePositions = st.nodePositions
        // re-position defaults accordingly
        set({ feNodes: get().feNodes.map((n: Node) => st.nodePositions[n.id] ? { ...n, position: st.nodePositions[n.id] } : n) })
      }
      if (st.nodeLabels && typeof st.nodeLabels === 'object') {
        set({ feNodes: get().feNodes.map((n: Node) => {
          const lbl = (st.nodeLabels as any)[n.id]
          return lbl ? { ...n, data: { ...(n.data as any), labelBase: lbl, label: lbl } } : n
        }) })
      }
      if (st.nodeConfigs && typeof st.nodeConfigs === 'object') {
        set({ feNodes: get().feNodes.map((n: Node) => {
          const cfg = (st.nodeConfigs as any)[n.id]
          return cfg ? { ...n, data: { ...(n.data as any), config: cfg } } : n
        }) })
      }
      set(patch)
    } catch {}

    // Note: State synchronization is now handled by zubridge
    // The main process can directly access the store via useMainStore
    // Flow events are handled by the scheduler directly updating the store

    // Persistence subscription (debounced)
    const save = debounce(() => {
      // TODO: Save flow editor state to workspace settings if needed
      // For now, skip saving in main process - state is already in the store
    }, 300)

    const unsub = (store as any).subscribe((st: any, prev: any) => {
      // Watch a subset of fields
      if (
        st.feNodes !== prev.feNodes ||
        st.feRedactorEnabled !== prev.feRedactorEnabled ||
        st.feRuleEmails !== prev.feRuleEmails ||
        st.feRuleApiKeys !== prev.feRuleApiKeys ||
        st.feRuleAwsKeys !== prev.feRuleAwsKeys ||
        st.feRuleNumbers16 !== prev.feRuleNumbers16 ||
        st.feBudgetUSD !== prev.feBudgetUSD ||
        st.feBudgetBlock !== prev.feBudgetBlock ||
        st.feErrorDetectEnabled !== prev.feErrorDetectEnabled ||
        st.feErrorDetectBlock !== prev.feErrorDetectBlock ||
        st.feNodePositions !== prev.feNodePositions ||
        st.feErrorDetectPatterns !== prev.feErrorDetectPatterns ||
        st.feRetryAttempts !== prev.feRetryAttempts ||
        st.feRetryBackoffMs !== prev.feRetryBackoffMs ||
        st.feCacheEnabled !== prev.feCacheEnabled
      ) {
        save()
      }
    })
    ;(store as any).__fe_unsub = unsub

    // Compute initial model selection
    get().feComputeResolvedModel()

    // React to provider/models/pricing changes to recompute model
    const unsubProv = (store as any).subscribe((st: any, prev: any) => {
      if (
        st.selectedProvider !== prev.selectedProvider ||
        st.modelsByProvider !== prev.modelsByProvider ||
        st.pricingConfig !== prev.pricingConfig
      ) {
        get().feComputeResolvedModel()
      }
    })
    ;(store as any).__fe_unsubProv = unsubProv

    // Note: Periodic save is started in initFlowEditor(), not here
  },

  feSetNodes: (nodesOrUpdater) => {
    const current = get().feNodes
    // Support functional updates like React's setState
    const nodes = typeof nodesOrUpdater === 'function'
      ? nodesOrUpdater(current)
      : nodesOrUpdater

    // Avoid unnecessary updates if nodes array is the same reference
    if (current === nodes) return

    set({ feNodes: nodes })
  },
  feSetEdges: (edgesOrUpdater) => {
    const current = get().feEdges
    // Support functional updates like React's setState
    const edges = typeof edgesOrUpdater === 'function'
      ? edgesOrUpdater(current)
      : edgesOrUpdater

    // Avoid unnecessary updates if edges array is the same reference
    if (current === edges) return

    set({ feEdges: edges })
  },
  feApplyNodeChanges: (changes) => {
    // simple apply (ReactFlow helpers not imported to keep slice lean)
    const map = new Map(get().feNodes.map((n) => [n.id, n]))

    for (const ch of changes) {
      const change = ch as any

      if (change.type === 'remove' && change.id) {
        // Prevent deletion of defaultContextStart node
        const node = map.get(change.id)
        if (node && (node.data as any)?.nodeType === 'defaultContextStart') {
          continue
        }
        map.delete(change.id)
      } else if (change.type === 'position' && change.id && change.position) {
        const n = map.get(change.id)
        if (n) {
          map.set(n.id, { ...n, position: change.position })
        }
      } else if (change.type === 'select' && change.id) {
        const n = map.get(change.id)
        if (n) {
          map.set(n.id, { ...n, selected: change.selected })
        }
      } else if (change.type === 'dimensions' && change.id) {
        // Update dimensions if provided
        const n = map.get(change.id)
        if (n && change.dimensions) {
          map.set(n.id, { ...n, width: change.dimensions.width, height: change.dimensions.height })
        }
      }
    }
    set({ feNodes: Array.from(map.values()) })
  },
  feUpdateNodePosition: ({ id, pos }: { id: string; pos: XYPosition }) => {
    set({
      feNodePositions: { ...get().feNodePositions, [id]: pos },
      feNodes: get().feNodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
    })
  },
  feAddNode: ({ nodeType, pos, label }: { nodeType: string; pos: XYPosition; label?: string }) => {
    // Prevent adding multiple defaultContextStart nodes
    if (nodeType === 'defaultContextStart') {
      const hasDefaultContextStart = get().feNodes.some(n => (n.data as any)?.nodeType === 'defaultContextStart')
      if (hasDefaultContextStart) {
        return
      }
    }

    const id = `${nodeType}-${Date.now()}`
    const lbl = label || nodeType

    // Set default config for certain node types
    let defaultConfig: Record<string, any> = {}
    if (nodeType === 'newContext') {
      defaultConfig = { provider: 'openai', model: 'gpt-4o' }
    } else if (nodeType === 'llmRequest') {
      defaultConfig = { provider: 'openai', model: 'gpt-4o' }
    }

    set({
      feNodes: [
        ...get().feNodes,
        { id, type: 'hifiNode', data: { nodeType: nodeType, label: lbl, labelBase: lbl, config: defaultConfig }, position: pos },
      ],
    })
  },
  feSetSelectedNodeId: (id) => set({ feSelectedNodeId: id }),
  feSetNodeLabel: ({ id, label }: { id: string; label: string }) => {
    const updatedNodes = get().feNodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), labelBase: label, label } } : n))
    set({ feNodes: updatedNodes })
  },
  fePatchNodeConfig: ({ id, patch }: { id: string; patch: Record<string, any> }) => {
    const updatedNodes = get().feNodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), config: { ...(n.data as any)?.config, ...patch } } } : n))
    set({ feNodes: updatedNodes })
  },

  feSetInput: (text) => set({ feInput: text }),
  feSetPatterns: (text) => set({ feErrorDetectPatterns: text }),
  feSetRetryAttempts: (n) => set({ feRetryAttempts: Math.max(1, Number(n || 1)) }),
  feSetRetryBackoffMs: (ms) => set({ feRetryBackoffMs: Math.max(0, Number(ms || 0)) }),
  feSetCacheEnabled: (v) => set({ feCacheEnabled: !!v }),

  feSetRedactorEnabled: (v) => set({ feRedactorEnabled: !!v }),
  feSetRuleEmails: (v) => set({ feRuleEmails: !!v }),
  feSetRuleApiKeys: (v) => set({ feRuleApiKeys: !!v }),
  feSetRuleAwsKeys: (v) => set({ feRuleAwsKeys: !!v }),
  feSetRuleNumbers16: (v) => set({ feRuleNumbers16: !!v }),
  feSetBudgetUSD: (usd) => set({ feBudgetUSD: usd }),
  feSetBudgetBlock: (v) => set({ feBudgetBlock: !!v }),
  feSetErrorDetectEnabled: (v) => set({ feErrorDetectEnabled: !!v }),
  feSetErrorDetectBlock: (v) => set({ feErrorDetectBlock: !!v }),

  feComputeResolvedModel: () => {
    try {
      const provider = (store as any).getState().selectedProvider as string | undefined
      const modelsByProvider = (store as any).getState().modelsByProvider as Record<string, Array<{ value: string; id?: string }>>
      const pricingConfig = (store as any).getState().pricingConfig as PricingConfig | undefined
      if (!provider) return set({ feResolvedModel: null })
      const models: any[] = (modelsByProvider?.[provider]) || []
      const pricing: any = (pricingConfig as any)?.[provider]
      if (Array.isArray(models) && pricing && typeof pricing === 'object') {
        let best: string | null = null
        let bestCost = Number.POSITIVE_INFINITY
        for (const m of models) {
          const id = (m?.value || m?.id || m) as string
          const p = pricing[id]
          if (!p) continue
          const total = (p.inputCostPer1M ?? 0) + (p.outputCostPer1M ?? 0)
          if (total < bestCost) { bestCost = total; best = id }
        }
        if (best) return set({ feResolvedModel: best })
      }
      // Fallback - just set to null in main process
      set({ feResolvedModel: null })
    } catch { set({ feResolvedModel: null }) }
  },

  flowInit: async () => {
    // Execute the flow by finding the Context Start node and running it
    // This kicks off the entire flow execution

    // Check if flow is loaded
    if (get().feNodes.length === 0) {
      return
    }

    const requestId = `flow-init-${Date.now()}`

    // Reset all node styles and status
    const resetNodes = get().feNodes.map((n) => ({
      ...n,
      style: { border: '2px solid #333', boxShadow: 'none' },
      data: { ...(n.data as any), status: undefined, durationMs: undefined, costUSD: undefined, detectedIntent: undefined },
    }))

    set({
      feRequestId: requestId,
      feStatus: 'running',
      feStreamingText: '',  // Reset streaming text
      feNodes: resetNodes,  // Reset node styles
      fePausedNode: null,   // Clear paused node
    })

    const storeState: any = (store as any).getState()
    const pricingConfig: PricingConfig | undefined = storeState.pricingConfig

    // Get session context (single source of truth for provider/model/messageHistory)
    const currentSession = storeState.sessions?.find((s: any) => s.id === storeState.currentId)
    const sessionContext = currentSession?.currentContext

    if (!sessionContext) {
      console.error('[flowInit] No session context found - cannot initialize flow')
      return
    }

    const modelPricing = (pricingConfig as any)?.[sessionContext.provider || '']?.[sessionContext.model || ''] || null

    console.log('[flowInit] Initializing flow from session context:', {
      sessionId: currentSession?.id,
      provider: sessionContext.provider,
      model: sessionContext.model,
      messageCount: sessionContext.messageHistory?.length || 0
    })

    const rules: string[] = []
    if (get().feRuleEmails) rules.push('emails')
    if (get().feRuleApiKeys) rules.push('apiKeys')
    if (get().feRuleAwsKeys) rules.push('awsKeys')
    if (get().feRuleNumbers16) rules.push('numbers16')
    const maxUSD = (() => { const v = parseFloat(get().feBudgetUSD); return isNaN(v) ? undefined : v })()

    // Convert ReactFlow nodes/edges (UI format) to FlowDefinition (execution format)
    // This handles the conversion from data.nodeType to type field for the scheduler
    const { reactFlowToFlowDefinition } = await import('../../services/flowConversion.js')
    const flowDef = reactFlowToFlowDefinition(get().feNodes, get().feEdges, 'editor-current')


    const initArgs: any = {
      requestId,
      flowId: 'simple-chat',
      flowDef,
      initialContext: sessionContext,  // Pass entire session context (single source of truth)
      policy: {
        autoApproveEnabled: storeState.autoApproveEnabled,
        autoApproveThreshold: storeState.autoApproveThreshold,
        redactor: { enabled: get().feRedactorEnabled, rules },
        budgetGuard: { maxUSD, blockOnExceed: get().feBudgetBlock },
        errorDetection: { enabled: get().feErrorDetectEnabled, blockOnFlag: get().feErrorDetectBlock, patterns: (get().feErrorDetectPatterns || '').split(/[\n,]/g).map((s) => s.trim()).filter(Boolean) },
        pricing: modelPricing ? { inputCostPer1M: modelPricing.inputCostPer1M, outputCostPer1M: modelPricing.outputCostPer1M } : undefined,
      },
    }

    // Execute the flow - the scheduler will find the Context Start node and begin execution

    // Store actions run in main process - call flow execution directly
    const { executeFlow } = await import('../../ipc/flows-v2/index.js')
    const { getWindow } = await import('../../core/window.js')
    const wc = getWindow()?.webContents
    await executeFlow(wc, initArgs)

    // Flow will pause at userInput automatically in V2
    // The pause state will be set by flow:event handlers
  },

  /**
   * Resume flow execution from saved state
   * Used when loading a session with a paused flow
   */
  feResumeFromState: async (savedRequestId: string) => {

    // Check if flow is loaded
    if (get().feNodes.length === 0) {
      return
    }

    // Restore the saved requestId
    set({
      feRequestId: savedRequestId,
      feStatus: 'waitingForInput',
      feStreamingText: ''
    })

    // The flow is already paused at a userInput node
    // User can resume it by calling feResume(userInput)
  },

  feClearLogs: () => {
    set({ feLog: '', feEvents: [], feStreamingText: '' })
  },

  feStop: async () => {
    const id = get().feRequestId
    if (!id) return

    // Store actions run in main process - call flow execution directly
    const { cancelFlow } = await import('../../ipc/flows-v2/index.js')
    await cancelFlow(id)
    set({ feStatus: 'stopped' })
  },

  feResume: async (userInput?: string) => {
    const id = get().feRequestId
    if (!id) {
      console.error('[feResume] No requestId found!')
      return
    }

    // Add user message to session
    if (userInput) {
      console.log('[feResume] Adding user message to session:', {
        userInputLength: userInput.length,
      })
      const state = store.getState() as any
      if (state.addSessionItem) {
        state.addSessionItem({
          type: 'message',
          role: 'user',
          content: userInput,
        })
      } else {
        console.warn('[feResume] addSessionItem not found in store!')
      }
    }

    // Update state for new execution
    // Note: Don't clear feStreamingText here - it should already be cleared by the chat node handler
    set({ feStatus: 'running' })

    // Store actions run in main process - call flow execution directly
    // Provider/model will be read from session context before next node execution
    const { resumeFlow } = await import('../../ipc/flows-v2/index.js')
    const { getWindow } = await import('../../core/window.js')
    const wc = getWindow()?.webContents
    if (!id) {
      console.error('[feResume] No flow ID provided')
      return
    }
    if (!wc) {
      console.error('[feResume] No window/webContents available')
      return
    }
    await resumeFlow(
      wc,
      id,
      userInput || ''
    )
  },

  feExportTrace: async () => {
    try {
      // TODO: Implement trace export in main process if needed
      set({ feLastExportMsg: 'Export not implemented in main process' })
    } catch (e: any) {
      set({ feLastExportMsg: `Export failed: ${String(e?.message || e)}` })
    }
  },

  feExportFlow: async () => {
    const { feSelectedTemplate, feNodes, feEdges } = get()

    // Clear previous result
    set({ feExportResult: null })

    if (!feSelectedTemplate) {
      set({ feExportResult: { success: false, error: 'No flow selected' } })
      return
    }

    try {
      // Get the profile data
      let profile: FlowProfile | null = null

      // Check system library first
      const systemTemplates = await loadSystemTemplates()
      if (systemTemplates[feSelectedTemplate]) {
        profile = systemTemplates[feSelectedTemplate]
      } else {
        // Check user library
        const { default: Store } = await import('electron-store')
        const profilesStore = new Store<Record<string, FlowProfile>>({
          name: 'flow-profiles',
          defaults: {},
        })
        profile = profilesStore.get(feSelectedTemplate) || null
      }

      // If not found in either library, create from current state
      if (!profile) {
        profile = {
          name: feSelectedTemplate,
          description: '',
          version: '7.0.0',
          nodes: feNodes.map((n) => {
            const data = n.data as any
            const label = data?.labelBase || data?.label
            return {
              id: n.id,
              nodeType: data?.nodeType || n.id.split('-')[0],
              label: label !== n.id ? label : undefined, // Only save if different from id
              config: data?.config || {},
              position: n.position,
              expanded: data?.expanded || false,
            }
          }),
          edges: feEdges.map((e) => ({
            id: e.id || `${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
            sourceHandle: (e as any)?.sourceHandle,
            targetHandle: (e as any)?.targetHandle,
          })),
        }
      }

      // Show save dialog
      const { dialog } = await import('electron')
      const result = await dialog.showSaveDialog({
        title: 'Export Flow',
        defaultPath: `${feSelectedTemplate}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })

      if (result.canceled || !result.filePath) {
        set({ feExportResult: { success: false, canceled: true } })
        return
      }

      // Write the file
      const fs = await import('fs/promises')
      await fs.writeFile(result.filePath, JSON.stringify(profile, null, 2), 'utf-8')

      set({ feExportResult: { success: true, path: result.filePath } })
    } catch (error) {
      console.error('[feExportFlow] Export failed:', error)
      set({ feExportResult: { success: false, error: String(error) } })
    }
  },

  feClearExportResult: () => {
    set({ feExportResult: null })
  },

  feImportFlow: async () => {
    // Clear previous result
    set({ feImportResult: null })

    try {
      // Show open dialog
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog({
        title: 'Import Flow',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        set({ feImportResult: { success: false, canceled: true } })
        return
      }

      const filePath = result.filePaths[0]

      // Read and parse the file
      const fs = await import('fs/promises')
      const content = await fs.readFile(filePath, 'utf-8')
      const profile = JSON.parse(content) as FlowProfile

      if (!profile.name) {
        set({ feImportResult: { success: false, error: 'Invalid flow file: missing name field' } })
        return
      }

      // Always import to user library, auto-rename if any conflict exists
      let finalName = profile.name

      // Check if this name already exists (either as system template or user profile)
      const existing = await loadFlowTemplate(finalName)

      if (existing) {
        // Name conflict - find a unique name by appending a number
        let counter = 1
        while (await loadFlowTemplate(`${profile.name}-${counter}`)) {
          counter++
        }
        finalName = `${profile.name}-${counter}`
      }

      // Save to user library (using the final name, which may have been renamed)
      const saveResult = await saveFlowProfile(
        profile.nodes as any || [],
        profile.edges as any || [],
        finalName,
        profile.description || ''
      )

      if (!saveResult.success) {
        set({ feImportResult: { success: false, error: saveResult.error || 'Failed to save imported flow' } })
        return
      }

      // Reload templates to include the new one
      await get().feLoadTemplates()

      set({ feImportResult: { success: true, name: finalName } })
    } catch (error) {
      console.error('[feImportFlow] Import failed:', error)
      set({ feImportResult: { success: false, error: String(error) } })
    }
  },

  feClearImportResult: () => {
    set({ feImportResult: null })
  },

  // ----- Template Management Actions -----
  feLoadTemplates: async () => {
    try {
      const templates = await listFlowTemplates()
      set({
        feAvailableTemplates: templates || [],
        feTemplatesLoaded: true
      })
    } catch (error) {
      console.error('Error loading templates:', error)
      set({
        feAvailableTemplates: [],
        feTemplatesLoaded: true
      })
    }
  },

  feLoadTemplate: async (templateId: string) => {
    try {
      const profile = await loadFlowTemplate(templateId)
      if (profile && profile.nodes && profile.edges) {
        // Create snapshot of loaded state
        const loadedState = JSON.stringify({
          nodes: profile.nodes.map((n: Node) => ({
            id: n.id,
            nodeType: (n.data as any)?.nodeType,
            config: (n.data as any)?.config,
            position: n.position,
            expanded: (n.data as any)?.expanded
          })),
          edges: profile.edges.map((e: Edge) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (e as any)?.sourceHandle,
            targetHandle: (e as any)?.targetHandle
          }))
        })

        const isSystem = await isSystemTemplate(templateId)
        set({
          feNodes: profile.nodes,
          feEdges: profile.edges,
          feCurrentProfile: isSystem ? '' : templateId,
          feSelectedTemplate: templateId,  // Update selector to show loaded template
          feHasUnsavedChanges: false,
          feLastSavedState: loadedState,
        })

        // Save as last used flow for this workspace (main process)
        try {
          const settings = await loadWorkspaceSettings()
          settings.lastUsedFlow = templateId
          await saveWorkspaceSettings(settings)
        } catch (e) {
          console.error('[flowEditor] Failed to save last used flow:', e)
        }

        // Update the current session's lastUsedFlow
        const storeState = get() as any
        if (storeState.updateCurrentSessionFlow) {
          await storeState.updateCurrentSessionFlow(templateId)
        }

        // Always start fresh on app load - don't try to resume paused flows
        // (Flow state is cleared when app reloads, so resuming would have no events anyway)

        // Fire and forget - don't block on flow initialization
        setTimeout(() => {
          void get().flowInit()
        }, 100)
      }
    } catch (error) {
      console.error('Error loading template:', error)
    }
  },

  feSaveCurrentProfile: async () => {
    const { feCurrentProfile, feNodes, feEdges } = get()
    const isSystem = await isSystemTemplate(feCurrentProfile)
    if (!feCurrentProfile || isSystem) {
      return
    }

    try {
      const result = await saveFlowProfile(
        feNodes,
        feEdges,
        feCurrentProfile,
        ''
      )
      if (result.success) {
        set({ feHasUnsavedChanges: false })
      } else {
        console.error('Save failed:', result.error)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    }
  },

  feStartPeriodicSave: () => {
    const state = get() as any

    // Clear any existing timeout and subscription
    if (state.__periodicSaveTimeout) {
      clearTimeout(state.__periodicSaveTimeout)
      state.__periodicSaveTimeout = null
    }
    if (state.__periodicSaveUnsubscribe) {
      state.__periodicSaveUnsubscribe()
      state.__periodicSaveUnsubscribe = null
    }


    // Subscribe to changes in nodes and edges
    const unsubscribe = store.subscribe(async (currentState: any, prevState: any) => {
      // Only watch nodes and edges for flow changes
      if (currentState.feNodes === prevState.feNodes && currentState.feEdges === prevState.feEdges) {
        return
      }


      const { feCurrentProfile, feSelectedTemplate } = currentState
      const profileToSave = feCurrentProfile || feSelectedTemplate

      // Don't save system templates
      const isSystem = await isSystemTemplate(profileToSave)
      if (!profileToSave || isSystem) {
        return
      }


      // Debounce: clear existing timeout and set a new one
      const state = get() as any
      if (state.__periodicSaveTimeout) {
        clearTimeout(state.__periodicSaveTimeout)
      }

      const timeout = setTimeout(async () => {
        const { feNodes, feEdges, feLastSavedState } = get()

        // Create snapshot of current state
        const currentState = JSON.stringify({
          nodes: feNodes.map(n => {
            const data = n.data as any
            return {
              id: n.id,
              kind: data?.nodeType,
              label: data?.labelBase || data?.label,
              config: data?.config,
              position: n.position,
              expanded: data?.expanded
            }
          }),
          edges: feEdges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (e as any)?.sourceHandle,
            targetHandle: (e as any)?.targetHandle
          }))
        })

        // Only save if state has changed
        if (currentState !== feLastSavedState) {
          try {
            const result = await saveFlowProfile(feNodes, feEdges, profileToSave, '')
            if (result.success) {
              set({ feLastSavedState: currentState, feHasUnsavedChanges: false })
            }
          } catch (error) {
            console.error('[Auto-save] Error saving profile:', error)
          }
        }
      }, 1000) // 1 second debounce

      // Store timeout reference
      ;(get() as any).__periodicSaveTimeout = timeout
    })

    // Store unsubscribe reference
    ;(get() as any).__periodicSaveUnsubscribe = unsubscribe
  },

  feStopPeriodicSave: () => {
    const state = get() as any


    if (state.__periodicSaveTimeout) {
      clearTimeout(state.__periodicSaveTimeout)
      state.__periodicSaveTimeout = null
    }
    if (state.__periodicSaveUnsubscribe) {
      state.__periodicSaveUnsubscribe()
      state.__periodicSaveUnsubscribe = null
    }
  },

  feSaveAsProfile: async (name: string) => {
    const { feNodes, feEdges } = get()
    const isSystem = await isSystemTemplate(name)
    if (!name || isSystem) {
      return
    }

    try {
      const result = await saveFlowProfile(
        feNodes,
        feEdges,
        name,
        ''
      )
      if (result.success) {
        set({
          feCurrentProfile: name,
          feHasUnsavedChanges: false,
          feSaveAsModalOpen: false,
          feNewProfileName: '',
          feSelectedTemplate: name,  // Update selector to show newly saved profile
        })
        // Reload templates to include the new one
        await get().feLoadTemplates()
      } else {
        console.error('Save As failed:', result.error)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    }
  },

  feDeleteProfile: async (name: string) => {
    const isSystem = await isSystemTemplate(name)
    if (!name || isSystem) {
      return
    }

    try {
      const result = await deleteFlowProfile(name)
      if (result.success) {
        // If we deleted the currently loaded profile, clear it
        if (get().feCurrentProfile === name) {
          set({ feCurrentProfile: '', feSelectedTemplate: '' })
        }
        // If it was selected in the dropdown, clear selection
        if (get().feSelectedTemplate === name) {
          set({ feSelectedTemplate: '' })
        }
        // Reload templates to remove the deleted one
        await get().feLoadTemplates()
      } else {
        console.error('Delete failed:', result.error)
      }
    } catch (error) {
      console.error('Error deleting profile:', error)
    }
  },

  feSetSelectedTemplate: (id: string) => set({ feSelectedTemplate: id }),
  feSetSaveAsModalOpen: (open: boolean) => set({ feSaveAsModalOpen: open }),
  feSetNewProfileName: (name: string) => set({ feNewProfileName: name }),
  feSetLoadTemplateModalOpen: (open: boolean) => set({ feLoadTemplateModalOpen: open }),

  // ----- Flow Event Handlers -----
  // These are called by the flow scheduler in the main process
  // They update the UI state to reflect flow execution progress

  feHandleNodeStart: (nodeId: string) => {
    set({
      feNodeExecutionState: {
        ...get().feNodeExecutionState,
        [nodeId]: {
          status: 'executing',
          cacheHit: false,
          style: {
            border: '3px solid #4dabf7',
            boxShadow: '0 0 20px rgba(77, 171, 247, 0.6), 0 0 40px rgba(77, 171, 247, 0.3)',
          },
        },
      },
    })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'nodeStart',
        nodeId,
      })
    }
  },

  feHandleNodeEnd: (nodeId: string, durationMs?: number) => {
    // Compute cost for LLM Request node
    const node = get().feNodes.find(n => n.id === nodeId)
    const nodeType = node?.data?.nodeType
    const isLlmRequest = nodeType === 'llmRequest'

    let tokenCost = null
    if (isLlmRequest) {
      const state = store.getState() as any

      // Use actual token usage from lastRequestTokenUsage if available
      if (state.lastRequestTokenUsage && state.lastRequestTokenUsage.cost) {
        tokenCost = state.lastRequestTokenUsage.cost
      }
    }

    // Finalize the node's execution box with cost
    const state = store.getState() as any
    if (state.finalizeNodeExecution) {
      state.finalizeNodeExecution({
        nodeId,
        cost: tokenCost || undefined
      })
    }

    // Update node execution state
    set({
      feNodeExecutionState: {
        ...get().feNodeExecutionState,
        [nodeId]: {
          ...get().feNodeExecutionState[nodeId],
          status: 'success',
          cacheHit: false,
          style: {
            border: '2px solid #51cf66',
            boxShadow: '0 0 15px rgba(81, 207, 102, 0.4)',
          },
        },
      },
    })

    // Add to session flow debug logs
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'nodeEnd',
        nodeId,
        durationMs,
      })
    }
  },

  feHandleIO: (nodeId: string, data: string) => {
    const logEntry = `[${nodeId}] ${data}\n`
    set({ feLog: get().feLog + logEntry })

    // Derive status + cache badge on node
    const d = String(data)
    let st: 'ok' | 'warn' | 'blocked' | 'masked' | undefined
    if (/\bblocked\b/i.test(d)) st = 'blocked'
    else if (/\bwarn/i.test(d)) st = 'warn'
    else if (/\bok\b/i.test(d)) st = 'ok'
    else if (/\bmasked\b/i.test(d)) st = 'masked'
    const isCacheHit = /\bcache-hit\b/i.test(d)

    const currentState = get().feNodeExecutionState[nodeId] || {}
    set({
      feNodeExecutionState: {
        ...get().feNodeExecutionState,
        [nodeId]: {
          ...currentState,
          status: st,
          cacheHit: isCacheHit ? true : currentState.cacheHit,
        },
      },
    })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'io',
        nodeId,
        data,
      })
    }
  },

  feHandleChunk: (text: string, nodeId?: string, provider?: string, model?: string) => {
    if (!text || !nodeId) return

    // Append text chunk to the node's execution box
    const node = get().feNodes.find(n => n.id === nodeId)
    if (!node) return

    const state = store.getState() as any
    if (state.appendToNodeExecution) {
      state.appendToNodeExecution({
        nodeId,
        nodeLabel: node.data?.label || node.data?.nodeType || 'Node',
        nodeKind: node.data?.nodeType || 'unknown',
        content: { type: 'text', text },
        // Use provided provider/model from execution context, fallback to global if not provided
        provider: provider || state.selectedProvider,
        model: model || state.selectedModel
      })
    }
  },

  feHandleToolStart: (toolName: string, nodeId?: string, toolArgs?: any, callId?: string, provider?: string, model?: string) => {
    if (!nodeId) return

    const activeTools = new Set(get().feActiveTools)
    activeTools.add(toolName)
    set({ feActiveTools: activeTools })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'toolStart',
        toolName,
      })
    }

    // Format badge label with contextual information
    let badgeLabel = toolName.toUpperCase()
    if (toolArgs) {
      const normalizedToolName = toolName.replace(/\./g, '_')

      if (normalizedToolName === 'fs_read_file' || normalizedToolName === 'fs_write_file') {
        const path = toolArgs.path || toolArgs.file_path
        if (path) {
          const filename = path.split(/[/\\]/).pop()
          badgeLabel = `${toolName.toUpperCase()}: ${filename}`
        }
      } else if (normalizedToolName === 'fs_read_dir' || normalizedToolName === 'fs_create_dir') {
        const path = toolArgs.path || toolArgs.dir_path
        if (path) {
          const foldername = path.split(/[/\\]/).pop() || path
          badgeLabel = `${toolName.toUpperCase()}: ${foldername}`
        }
      }
    }

    // Append tool badge to the node's execution box
    const node = get().feNodes.find(n => n.id === nodeId)
    if (!node) return

    if (state.appendToNodeExecution) {
      state.appendToNodeExecution({
        nodeId,
        nodeLabel: node.data?.label || node.data?.nodeType || 'Node',
        nodeKind: node.data?.nodeType || 'unknown',
        content: {
          type: 'badge',
          badge: {
            id: callId || `badge-${Date.now()}`,
            type: 'tool' as const,
            label: badgeLabel,
            icon: '🔧',
            color: 'orange',
            variant: 'filled' as const,
            status: 'running' as const,
            timestamp: Date.now()
          }
        },
        // Use provided provider/model from execution context, fallback to global if not provided
        provider: provider || state.selectedProvider,
        model: model || state.selectedModel
      })
    }
  },

  feHandleToolEnd: (toolName: string, callId?: string, nodeId?: string) => {
    const activeTools = new Set(get().feActiveTools)
    activeTools.delete(toolName)
    set({ feActiveTools: activeTools })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'toolEnd',
        toolName,
      })
    }

    // Update badge status to success
    if (callId && nodeId && state.updateBadgeInNodeExecution) {
      state.updateBadgeInNodeExecution({
        nodeId,
        badgeId: callId,
        updates: {
          status: 'success',
          color: 'green'
        }
      })
    }
  },

  feHandleToolError: (toolName: string, error: string, callId?: string, nodeId?: string) => {
    const activeTools = new Set(get().feActiveTools)
    activeTools.delete(toolName)
    set({ feActiveTools: activeTools })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'toolError',
        toolName,
        error,
      })
    }

    // Update badge status to error
    if (callId && nodeId && state.updateBadgeInNodeExecution) {
      state.updateBadgeInNodeExecution({
        nodeId,
        badgeId: callId,
        updates: {
          status: 'error',
          color: 'red'
        }
      })
    }
  },

  feHandleIntentDetected: (nodeId: string, intent: string, provider?: string, model?: string) => {
    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'intentDetected',
        nodeId,
        intent,
        provider,
        model,
      })
    }

    // Append intent badge to the node's execution box
    const node = get().feNodes.find(n => n.id === nodeId)
    if (!node) return

    if (state.appendToNodeExecution) {
      state.appendToNodeExecution({
        nodeId,
        nodeLabel: node.data?.label || node.data?.nodeType || 'Node',
        nodeKind: node.data?.nodeType || 'unknown',
        content: {
          type: 'badge',
          badge: {
            id: `intent-${Date.now()}`,
            type: 'intent' as const,
            label: intent,
            icon: '🎯',
            color: 'orange',
            variant: 'light' as const,
            status: 'success' as const,
            timestamp: Date.now()
          }
        },
        provider,
        model
      })
    }
  },

  feHandleTokenUsage: (provider: string, model: string, usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
    if (provider && model && usage) {
      const state = store.getState() as any

      // Add to session flow debug logs
      if (state.addFlowDebugLog) {
        state.addFlowDebugLog({
          requestId: get().feRequestId || '',
          type: 'tokenUsage',
          provider,
          model,
          usage,
        })
      }

      if (state.recordTokenUsage) {
        // Call with object parameter as expected by the function signature
        state.recordTokenUsage({ provider, model, usage })
      }

      // Update the most recent badge group with matching provider/model to add cost info
      // This handles cases like intentRouter where the badge is created before token usage is reported
      // We need to wait a tick for recordTokenUsage to update lastRequestTokenUsage
      setTimeout(() => {
        const updatedState = store.getState() as any
        if (updatedState.lastRequestTokenUsage) {
          const { cost } = updatedState.lastRequestTokenUsage
          if (cost && updatedState.currentId) {
            const currentSession = updatedState.sessions?.find((s: any) => s.id === updatedState.currentId)
            if (currentSession) {
              // Find the most recent badge group with matching provider/model but no cost
              for (let i = currentSession.items.length - 1; i >= 0; i--) {
                const item = currentSession.items[i]
                if (
                  item.type === 'badge-group' &&
                  item.provider === provider &&
                  item.model === model &&
                  !item.cost
                ) {
                  // Update this badge group with cost information using the store's setState
                  const updatedSessions = updatedState.sessions.map((sess: any) => {
                    if (sess.id !== updatedState.currentId) return sess

                    return {
                      ...sess,
                      items: sess.items.map((sessionItem: any, idx: number) =>
                        idx === i && sessionItem.type === 'badge-group'
                          ? { ...sessionItem, cost }
                          : sessionItem
                      ),
                      updatedAt: Date.now(),
                    }
                  })

                  ;(store as any).setState({ sessions: updatedSessions })

                  // Save after updating
                  if (updatedState.saveCurrentSession) {
                    updatedState.saveCurrentSession()
                  }
                  break
                }
              }
            }
          }
        }
      }, 0)
    }
  },

  feHandleWaitingForInput: (nodeId: string, requestId: string) => {
    // Flush streaming text to assistant message before pausing
    const streamingText = get().feStreamingText
    if (streamingText) {
      const state = store.getState() as any
      const node = get().feNodes.find(n => n.id === nodeId)

      if (state.addSessionItem) {
        state.addSessionItem({
          type: 'message',
          role: 'assistant',
          content: streamingText,
          nodeId,  // Include nodeId so message can be grouped with badges
          nodeLabel: node?.data?.label || 'LLM Request',
          nodeKind: node?.data?.nodeType || 'llmRequest',
        })
      }
    }

    // Update node execution state to show it's waiting for input
    set({
      feStatus: 'waitingForInput',
      fePausedNode: nodeId,
      feStreamingText: '',
      feNodeExecutionState: {
        ...get().feNodeExecutionState,
        [nodeId]: {
          status: 'executing',  // Keep as executing since it's paused mid-execution
          style: {
            border: '3px solid #f59e0b',
            boxShadow: '0 0 20px rgba(245, 158, 11, 0.6), 0 0 40px rgba(245, 158, 11, 0.3)',
          },
        },
      },
    })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: requestId,
        type: 'waitingForInput',
        nodeId,
      })
    }

    // Save flow state to session
    const currentSession = state.sessions?.find((s: any) => s.id === state.currentId)
    if (currentSession && state.saveCurrentSession) {
      const sessions = state.sessions.map((s: any) =>
        s.id === state.currentId
          ? {
              ...s,
              flowState: {
                requestId,
                pausedAt: Date.now(),
                pausedNodeId: nodeId
              },
              updatedAt: Date.now()
            }
          : s
      )
      ;(store as any).setState({ sessions })
      state.saveCurrentSession()
    }
  },

  feHandleDone: () => {
    set({ feStatus: 'stopped', feMainFlowContext: null, feIsolatedContexts: {} })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'done',
      })
    }

    // Clear flow state from session
    const currentSession = state.sessions?.find((s: any) => s.id === state.currentId)
    if (currentSession && state.saveCurrentSession) {
      const sessions = state.sessions.map((s: any) =>
        s.id === state.currentId
          ? { ...s, flowState: undefined, updatedAt: Date.now() }
          : s
      )
      ;(store as any).setState({ sessions })
      state.saveCurrentSession()
    }
  },

  feHandleError: (error: string) => {
    console.error('[flowEditor] Flow error:', error)
    set({ feStatus: 'stopped', feMainFlowContext: null, feIsolatedContexts: {} })

    // Add to session flow debug logs
    const state = store.getState() as any
    if (state.addFlowDebugLog) {
      state.addFlowDebugLog({
        requestId: get().feRequestId || '',
        type: 'error',
        error,
      })
    }

    // Clear flow state from session
    const currentSession = state.sessions?.find((s: any) => s.id === state.currentId)
    if (currentSession && state.saveCurrentSession) {
      const sessions = state.sessions.map((s: any) =>
        s.id === state.currentId
          ? { ...s, flowState: undefined, updatedAt: Date.now() }
          : s
      )
      ;(store as any).setState({ sessions })
      state.saveCurrentSession()
    }
  },

  // Debounced sync to session.currentContext
  // Now handles both main and isolated contexts
  feUpdateMainFlowContext: (() => {
    let syncTimeout: NodeJS.Timeout | null = null

    return (context: MainFlowContext) => {
      console.log('[feUpdateMainFlowContext] Updating context:', {
        contextId: context.contextId,
        contextType: context.contextType,
        provider: context.provider,
        model: context.model,
        systemInstructions: context.systemInstructions?.substring(0, 50) + '...',
        messageHistoryLength: context.messageHistory.length
      })

      // Update the appropriate context based on type
      if (context.contextType === 'isolated') {
        // Update isolated context
        set((state) => ({
          feIsolatedContexts: {
            ...state.feIsolatedContexts,
            [context.contextId]: context
          }
        }))
      } else {
        // Update main context
        set({ feMainFlowContext: context })

        // Debounce sync to session.currentContext (1 second) - only for main context
        if (syncTimeout) clearTimeout(syncTimeout)
        syncTimeout = setTimeout(() => {
          const state = store.getState() as any
          if (state.updateCurrentContext) {
            console.log('[feUpdateMainFlowContext] Syncing to session.currentContext', {
              messageHistoryLength: context.messageHistory.length
            })
            // Sync shallow copy to session (only fields that exist in both)
            state.updateCurrentContext({
              provider: context.provider,
              model: context.model,
              systemInstructions: context.systemInstructions,
              messageHistory: context.messageHistory,
              // temperature is not in MainFlowContext, only in Session.currentContext
            })
          }
        }, 1000)
      }
    }
  })(),

  // User input management - used by userInput node
  // This replaces the scheduler.waitForUserInput() pattern
  // The resolver map is stored in a closure to keep it out of the serialized state
  feWaitForUserInput: (() => {
    // Map of nodeId -> resolver function
    // This is NOT part of the Zustand state - it's internal plumbing
    const userInputResolvers = new Map<string, (input: string) => void>()

    // Store the resolver map in a way that feResolveUserInput can access it
    // We'll attach it to the function itself
    const waitFn = async (nodeId: string): Promise<string> => {

      // Get current requestId
      const requestId = get().feRequestId || 'unknown'

      // Notify UI that we're waiting for input
      get().feHandleWaitingForInput(nodeId, requestId)

      // Create a promise that will be resolved when feResolveUserInput is called
      const userInput = await new Promise<string>((resolve) => {
        userInputResolvers.set(nodeId, resolve)
      })

      userInputResolvers.delete(nodeId)

      return userInput
    }

    // Attach the resolver map to the function so feResolveUserInput can access it
    ;(waitFn as any)._resolvers = userInputResolvers

    return waitFn
  })(),

  feResolveUserInput: (nodeId: string, userInput: string) => {

    // Access the resolver map from the feWaitForUserInput function
    const resolvers = (get().feWaitForUserInput as any)._resolvers as Map<string, (input: string) => void>

    const resolver = resolvers?.get(nodeId)
    if (resolver) {
      resolver(userInput)
    } else {
    }
  },

  // Portal registry - used by portal nodes
  // This replaces the scheduler.portalRegistry pattern
  feSetPortalData: (() => {
    // Map of portalId -> { context?, data? }
    // This is NOT part of the Zustand state - it's internal plumbing
    const portalRegistry = new Map<string, { context?: any; data?: any }>()

    const setFn = (portalId: string, context?: any, data?: any) => {
      portalRegistry.set(portalId, { context, data })
    }

    // Attach the registry to the function so other actions can access it
    ;(setFn as any)._registry = portalRegistry

    return setFn
  })(),

  feGetPortalData: (portalId: string) => {
    // Access the registry from the feSetPortalData function
    const registry = (get().feSetPortalData as any)._registry as Map<string, { context?: any; data?: any }>
    return registry?.get(portalId)
  },

  feClearPortalData: (portalId: string) => {
    // Access the registry from the feSetPortalData function
    const registry = (get().feSetPortalData as any)._registry as Map<string, { context?: any; data?: any }>
    registry?.delete(portalId)
  },
})

