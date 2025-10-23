import type { StateCreator } from 'zustand'
import type { Edge, Node, NodeChange, XYPosition } from 'reactflow'
import type { PricingConfig } from '../types'
import { initializeFlowProfiles, listFlowTemplates, loadFlowTemplate, saveFlowProfile, deleteFlowProfile, isSystemTemplate, loadSystemTemplates, type FlowTemplate, type FlowProfile } from '../../services/flowProfiles'
import type { MainFlowContext } from '../../ipc/flows-v2/types'
import { loadWorkspaceSettings, saveWorkspaceSettings } from '../../ipc/workspace'

// Flow runtime event type (mirrors renderer usage)
export type FlowEvent = {
  requestId: string
  type: 'nodeStart' | 'nodeEnd' | 'io' | 'done' | 'error' | 'waitingForInput' | 'chunk' | 'toolStart' | 'toolEnd' | 'toolError' | 'intentDetected' | 'tokenUsage' | 'rateLimitWait'
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

// Buffered/Throttled flush to reduce zubridge IPC during execution
let __feFlushTimer: NodeJS.Timeout | null = null
let __fePendingEvents: FlowEvent[] = []
let __fePendingFlowState: Record<string, NodeExecutionState> = {}
let __fePendingMainContext: MainFlowContext | null | undefined = undefined
let __fePendingIsolatedContexts: Record<string, MainFlowContext> | null = null
let __fePendingActiveTools: Set<string> | null = null

function __scheduleFeFlush(set: any, get: any, interval = 100) {
  if (__feFlushTimer) return
  __feFlushTimer = setTimeout(() => {
    __feFlushTimer = null
    const events = __fePendingEvents
    const statePatch = __fePendingFlowState
    const mainCtx = __fePendingMainContext
    const isoCtxs = __fePendingIsolatedContexts
    const activeTools = __fePendingActiveTools
    __fePendingEvents = []
    __fePendingFlowState = {}
    __fePendingMainContext = undefined
    __fePendingIsolatedContexts = null
    __fePendingActiveTools = null

    const updates: any = {}
    if (events.length) {
      const merged = [...get().feEvents, ...events]
      updates.feEvents = merged.slice(-500)
    }
    if (Object.keys(statePatch).length) {
      updates.feFlowState = { ...get().feFlowState, ...statePatch }
    }
    // Guard: avoid feFlowState churn while idle; allow during 'running' and 'waitingForInput'
    try {
      const st = get().feStatus
      if (updates.feFlowState && !(st === 'running' || st === 'waitingForInput')) {
        const changedIds = Object.keys(statePatch)
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[flowEditor] Dropping feFlowState patch while idle:', { status: st, changedIds })
        }
        delete (updates as any).feFlowState
      }
    } catch {}
    if (mainCtx !== undefined) {
      try {
        const prev = get().feMainFlowContext
        const same = (() => {
          const a: any = prev || {}
          const b: any = mainCtx || {}
          if (!a && !b) return true
          if (!a || !b) return false
          if (a.provider !== b.provider) return false
          if (a.model !== b.model) return false
          if ((a.systemInstructions || '') !== (b.systemInstructions || '')) return false
          const ah = Array.isArray(a.messageHistory) ? a.messageHistory.length : 0
          const bh = Array.isArray(b.messageHistory) ? b.messageHistory.length : 0
          return ah === bh
        })()
        if (!same) {
          updates.feMainFlowContext = mainCtx
        }
      } catch {
        updates.feMainFlowContext = mainCtx
      }
    }
    if (isoCtxs) {
      updates.feIsolatedContexts = { ...get().feIsolatedContexts, ...isoCtxs }
    }
    if (activeTools) {
      try {
        const prev = get().feActiveTools as Set<string>
        let equal = !!prev && prev.size === activeTools.size
        if (equal) {
          for (const v of activeTools) { if (!prev.has(v)) { equal = false; break } }
        }
        if (!equal) {
          updates.feActiveTools = new Set(activeTools)
        }
      } catch {
        // Fallback: commit update if equality check fails
        updates.feActiveTools = new Set(activeTools)
      }
    }
    if (Object.keys(updates).length) {
      try {
        if (get().feStatus === 'stopped') {
          // Debug: detect unexpected flushes while idle
          console.debug('[flowEditor] fe* flush while stopped:', Object.keys(updates))
        }
      } catch {}
      set(updates)
    }
  }, interval)
}

function __queueFeEvent(set: any, get: any, evt: FlowEvent) {
  __fePendingEvents.push(evt)
  __scheduleFeFlush(set, get)
}
function __queueFeFlowState(set: any, get: any, nodeId: string, patch: Partial<NodeExecutionState>) {
  // Only accept execution-state patches while running or paused for input
  try {
    const status = get().feStatus
    if (!(status === 'running' || status === 'waitingForInput')) {
      // Ignore entirely when idle to prevent UI interactions (like dragging) from causing churn
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[flowEditor] __queueFeFlowState ignored (idle):', { status, nodeId, patchKeys: Object.keys(patch || {}) })
      }
      return
    }
  } catch {}
  const base = __fePendingFlowState[nodeId] || get().feFlowState[nodeId] || {}
  const next = { ...base, ...patch }
  // Shallow equality guard to avoid churn when nothing actually changes
  let same = true
  for (const k of Object.keys(next)) {
    const bv: any = (base as any)[k]
    const nv: any = (next as any)[k]
    if (k === 'style') {
      const bstyle = bv || {}
      const nstyle = nv || {}
      if (bstyle.border !== nstyle.border || bstyle.boxShadow !== nstyle.boxShadow) { same = false; break }
    } else if (bv !== nv) { same = false; break }
  }
  if (same) {
    return
  }
  __fePendingFlowState[nodeId] = next
  __scheduleFeFlush(set, get)
}
function __queueFeMainContext(set: any, get: any, ctx: MainFlowContext) {
  try {
    const status = get().feStatus
    if (!(status === 'running' || status === 'waitingForInput')) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[flowEditor] __queueFeMainContext ignored (idle):', { status })
      }
      return
    }
  } catch {}
  __fePendingMainContext = ctx
  __scheduleFeFlush(set, get)
}
function __queueFeIsolatedContext(set: any, get: any, contextId: string, ctx: MainFlowContext) {
  if (!__fePendingIsolatedContexts) __fePendingIsolatedContexts = {}
  __fePendingIsolatedContexts[contextId] = ctx
  __scheduleFeFlush(set, get)
}
function __queueFeActiveTools(set: any, get: any, tools: Set<string>) {
  __fePendingActiveTools = new Set(tools)
  __scheduleFeFlush(set, get)
}

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
  // Graph state - Mirror of renderer's local state
  // Synced renderer → store when user saves/executes (used by scheduler to read configs)
  // NEVER synced store → renderer (except at initial session load)
  feNodes: Node[]
  feEdges: Edge[]

  // Execution state - Simple metadata keyed by node ID
  // Updated by scheduler during execution, synced store → renderer for visual styling
  feFlowState: Record<string, NodeExecutionState>  // Plain object for IPC serialization

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

  // Transient diff preview (loaded on demand; not persisted)
  feLatestDiffPreview: Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }> | null

  // Loaded tool results (keyed by callId, loaded on demand; not persisted)
  feLoadedToolResults: Record<string, any>

  // Shallow params for tools keyed by callId (kept shallow to avoid deep snapshot truncation)
  feToolParamsByKey: Record<string, any>

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

  // Unified tool result cache actions (replaces separate diff/search caches)
  registerToolResult: (params: { key: string; data: any }) => void
  loadToolResult: (params: { key: string }) => void
  clearToolResult: (params: { key: string }) => void

  // Legacy diff preview actions (for backward compatibility with feLatestDiffPreview state)
  loadDiffPreview: (params: { key: string }) => Promise<void>
  clearLatestDiffPreview: () => void
  feLoadTemplates: () => Promise<void>
  feLoadTemplate: (params: { templateId: string }) => Promise<void>
  feSaveCurrentProfile: () => Promise<void>
  feStartPeriodicSave: () => void
  feStopPeriodicSave: () => void
  feSaveAsProfile: (params: { name: string }) => Promise<void>
  feDeleteProfile: (params: { name: string }) => Promise<void>
  feExportFlow: () => Promise<void>
  feClearExportResult: () => void
  feImportFlow: () => Promise<void>
  feClearImportResult: () => void
  feCreateNewFlowNamed: (params: { name: string }) => Promise<void>
  feSetSelectedTemplate: (params: { id: string }) => void
  feSetSaveAsModalOpen: (params: { open: boolean }) => void
  feSetNewProfileName: (params: { name: string }) => void
  feSetLoadTemplateModalOpen: (params: { open: boolean }) => void

  // Graph state setters - used by renderer to sync local state when needed (execute, save)
  feSetNodes: (params: { nodes: Node[] }) => void
  feSetEdges: (params: { edges: Edge[] }) => void
  feApplyNodeChanges: (changes: NodeChange[]) => void
  feUpdateNodePosition: (params: { id: string; pos: XYPosition }) => void
  feAddNode: (params: { nodeType: string; pos: XYPosition; label?: string }) => void
  feSetSelectedNodeId: (params: { id: string | null }) => void
  feSetNodeLabel: (params: { id: string; label: string }) => void
  fePatchNodeConfig: (params: { id: string; patch: Record<string, any> }) => void

  feSetInput: (params: { text: string }) => void
  feSetPatterns: (params: { text: string }) => void
  feSetRetryAttempts: (params: { n: number }) => void
  feSetRetryBackoffMs: (params: { ms: number }) => void
  feSetCacheEnabled: (params: { v: boolean }) => void

  feSetRedactorEnabled: (params: { v: boolean }) => void
  feSetRuleEmails: (params: { v: boolean }) => void
  feSetRuleApiKeys: (params: { v: boolean }) => void
  feSetRuleAwsKeys: (params: { v: boolean }) => void
  feSetRuleNumbers16: (params: { v: boolean }) => void
  feSetBudgetUSD: (params: { usd: string }) => void
  feSetBudgetBlock: (params: { v: boolean }) => void
  feSetErrorDetectEnabled: (params: { v: boolean }) => void
  feSetErrorDetectBlock: (params: { v: boolean }) => void

  feComputeResolvedModel: () => void

  feClearLogs: () => void
  flowInit: () => Promise<void>
  feResumeFromState: (requestId: string) => Promise<void>
  feStop: () => Promise<void>
  feResume: (params: { userInput?: string }) => Promise<void>
  feExportTrace: () => Promise<void>

  // Flow event handlers - called by scheduler to update UI state
  feHandleNodeStart: (nodeId: string) => void
  feHandleNodeEnd: (nodeId: string, durationMs?: number) => void
  feUpdateMainFlowContext: (context: MainFlowContext) => void
  feHandleIO: (nodeId: string, data: string) => void
  feHandleChunk: (text: string, nodeId?: string, provider?: string, model?: string) => void
  feHandleToolStart: (toolName: string, nodeId?: string, toolArgs?: any, callId?: string, provider?: string, model?: string) => void
  feHandleToolEnd: (toolName: string, callId?: string, nodeId?: string, result?: any) => void
  feHandleToolError: (toolName: string, error: string, callId?: string, nodeId?: string) => void
  feHandleIntentDetected: (nodeId: string, intent: string, provider?: string, model?: string) => void
  feHandleTokenUsage: (provider: string, model: string, usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  feHandleRateLimitWait: (nodeId: string, attempt: number, waitMs: number, reason?: string, provider?: string, model?: string) => void
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

// Wait for pending flow-editor event flushes and give the scheduler a moment
// to propagate cancellation and final events (usage, errors). Best-effort only.
async function __waitForFeSettle(maxWaitMs = 1000): Promise<void> {
  const start = Date.now()
  // Wait for the throttled flush (100ms window) to complete
  while (__feFlushTimer) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
    if (Date.now() - start > maxWaitMs) break
  }
  // Small grace to allow any final handlers to run
  await new Promise((r) => setTimeout(r, 50))
}

// Unified in-memory cache for tool execution results (main process only, not persisted)
// Keyed by callId (tool execution ID), stores any data that's too large to put in the store
// This replaces the separate diff/search caches and works for any tool
const __feToolResultCache = new Map<string, any>()

// Module-scoped handles for periodic auto-save (do not put these in Zustand state)
let __fePeriodicSaveTimeout: NodeJS.Timeout | null = null
let __fePeriodicSaveUnsubscribe: (() => void) | null = null


export const createFlowEditorSlice: StateCreator<FlowEditorSlice> = (set, get, store) => ({
  // Initial state - will be populated by initializeFlowProfiles()
  feNodes: [],
  feEdges: [],
  feFlowState: {},
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

  // Transient diff preview
  feLatestDiffPreview: null,

  // Loaded tool results
  feLoadedToolResults: {},

  // Shallow tool params by callId
  feToolParamsByKey: {},

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
  // Unified tool result cache (works for any tool)
  registerToolResult: ({ key, data }: { key: string; data: any }) => {
    __feToolResultCache.set(key, data)
  },
  loadToolResult: ({ key }: { key: string }) => {
    const data = __feToolResultCache.get(key)

    // If undefined in cache, mark as loaded-empty with null to avoid repeated loads
    if (data === undefined) {
      const current = get().feLoadedToolResults?.[key]
      if (current === null) return // already marked loaded-empty
      set((state) => ({
        feLoadedToolResults: {
          ...state.feLoadedToolResults,
          [key]: null,
        },
      }))
      return
    }

    // Only update if changed to avoid unnecessary rerenders
    const current = get().feLoadedToolResults?.[key]
    if (current === data) return

    set((state) => ({
      feLoadedToolResults: {
        ...state.feLoadedToolResults,
        [key]: data,
      },
    }))
  },
  clearToolResult: ({ key }: { key: string }) => {
    __feToolResultCache.delete(key)
    set((state) => {
      const { [key]: _, ...rest } = state.feLoadedToolResults
      return { feLoadedToolResults: rest }
    })
  },

  // Legacy diff preview actions (for backward compatibility)
  loadDiffPreview: async ({ key }: { key: string }) => {
    const data = __feToolResultCache.get(key) || []
    set({ feLatestDiffPreview: data })
  },
  clearLatestDiffPreview: () => set({ feLatestDiffPreview: null }),

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
        // Apply positions from saved profile to nodes
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

  // ----- Graph Synchronization -----



  feSetNodes: ({ nodes }: { nodes: Node[] }) => {
    const current = get().feNodes
    if (current === nodes) return

    // Drop if structurally identical to avoid churn from ref-only updates
    const nodesDeepEqual = (a: Node[] | undefined, b: Node[] | undefined): boolean => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false
      if (a.length !== b.length) return false
      // Compare by id with minimal important fields
      for (let i = 0; i < a.length; i++) {
        const an = a[i] as any
        const bn = b[i] as any
        if (an?.id !== bn?.id) return false
        // Position
        const ap = an?.position || {}
        const bp = bn?.position || {}
        if (ap.x !== bp.x || ap.y !== bp.y) return false
        // Basic data fields
        const ad = an?.data || {}
        const bd = bn?.data || {}
        if (ad?.labelBase !== bd?.labelBase) return false
        if (ad?.label !== bd?.label) return false
        if (ad?.nodeType !== bd?.nodeType) return false
        // Config: stringify minimally; safe because configs are small
        const ac = ad?.config ?? null
        const bc = bd?.config ?? null
        if (JSON.stringify(ac) !== JSON.stringify(bc)) return false
      }
      return true
    }

    try {
      if (nodesDeepEqual(current, nodes)) {
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[flowEditor] feSetNodes dropped (deep-equal)')
        }
        return
      }
    } catch {}

    set({ feNodes: nodes })
  },
  feSetEdges: ({ edges }: { edges: Edge[] }) => {
    const current = get().feEdges
    if (current === edges) return

    const edgesDeepEqual = (a: Edge[] | undefined, b: Edge[] | undefined): boolean => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        const ae = a[i] as any
        const be = b[i] as any
        if (ae?.id !== be?.id) return false
        if (ae?.source !== be?.source) return false
        if (ae?.target !== be?.target) return false
        const ash = ae?.sourceHandle ?? undefined
        const bsh = be?.sourceHandle ?? undefined
        const ath = ae?.targetHandle ?? undefined
        const bth = be?.targetHandle ?? undefined
        if (ash !== bsh || ath !== bth) return false
      }
      return true
    }

    try {
      if (edgesDeepEqual(current, edges)) {
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[flowEditor] feSetEdges dropped (deep-equal)')
        }
        return
      }
    } catch {}

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
      feNodes: get().feNodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
    })
  },
  feAddNode: ({ nodeType, pos, label }: { nodeType: string; pos: XYPosition; label?: string }) => {
    console.log('[feAddNode] Called with:', { nodeType, pos, label })

    // Prevent adding multiple defaultContextStart nodes
    if (nodeType === 'defaultContextStart') {
      const hasDefaultContextStart = get().feNodes.some(n => (n.data as any)?.nodeType === 'defaultContextStart')
      if (hasDefaultContextStart) {
        console.log('[feAddNode] Prevented adding duplicate defaultContextStart')
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

    const newNode = { id, type: 'hifiNode', data: { nodeType: nodeType, label: lbl, labelBase: lbl, config: defaultConfig }, position: pos }
    console.log('[feAddNode] Adding node:', newNode)

    set({
      feNodes: [
        ...get().feNodes,
        newNode,
      ],
    })

    console.log('[feAddNode] Node added, new count:', get().feNodes.length)
  },
  feSetSelectedNodeId: ({ id }: { id: string | null }) => set({ feSelectedNodeId: id }),
  feSetNodeLabel: ({ id, label }: { id: string; label: string }) => {
    const updatedNodes = get().feNodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), labelBase: label, label } } : n))
    set({ feNodes: updatedNodes })
  },
  fePatchNodeConfig: ({ id, patch }: { id: string; patch: Record<string, any> }) => {
    const updatedNodes = get().feNodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), config: { ...(n.data as any)?.config, ...patch } } } : n))
    set({ feNodes: updatedNodes })
  },

  feSetInput: ({ text }: { text: string }) => set({ feInput: text }),
  feSetPatterns: ({ text }: { text: string }) => set({ feErrorDetectPatterns: text }),
  feSetRetryAttempts: ({ n }: { n: number }) => set({ feRetryAttempts: Math.max(1, Number(n || 1)) }),
  feSetRetryBackoffMs: ({ ms }: { ms: number }) => set({ feRetryBackoffMs: Math.max(0, Number(ms || 0)) }),
  feSetCacheEnabled: ({ v }: { v: boolean }) => set({ feCacheEnabled: !!v }),

  feSetRedactorEnabled: ({ v }: { v: boolean }) => set({ feRedactorEnabled: !!v }),
  feSetRuleEmails: ({ v }: { v: boolean }) => set({ feRuleEmails: !!v }),
  feSetRuleApiKeys: ({ v }: { v: boolean }) => set({ feRuleApiKeys: !!v }),
  feSetRuleAwsKeys: ({ v }: { v: boolean }) => set({ feRuleAwsKeys: !!v }),
  feSetRuleNumbers16: ({ v }: { v: boolean }) => set({ feRuleNumbers16: !!v }),
  feSetBudgetUSD: ({ usd }: { usd: string }) => set({ feBudgetUSD: usd }),
  feSetBudgetBlock: ({ v }: { v: boolean }) => set({ feBudgetBlock: !!v }),
  feSetErrorDetectEnabled: ({ v }: { v: boolean }) => set({ feErrorDetectEnabled: !!v }),
  feSetErrorDetectBlock: ({ v }: { v: boolean }) => set({ feErrorDetectBlock: !!v }),

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
    // Kick-off should ACK to renderer immediately; heavy work runs async.

    // Check if flow is loaded
    if (get().feNodes.length === 0) {
      return
    }

    // Use session ID as requestId so terminal tools bind to the session's PTY
    const state = get() as any
    const currentSessionId = state.currentId
    const requestId = currentSessionId || `flow-init-${Date.now()}`

    // Reset all node styles and status (fast)
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

    // Defer heavy work to avoid zubridge ack timeout
    setImmediate(async () => {
      try {
        const storeState: any = (store as any).getState()

        // Get session context (single source of truth for provider/model/messageHistory)
        const currentSession = storeState.sessions?.find((s: any) => s.id === storeState.currentId)
        const sessionContext = currentSession?.currentContext
        if (!sessionContext) {
          console.error('[flowInit] No session context found - cannot initialize flow')
          __queueFeEvent(set, get, { requestId, type: 'error', timestamp: Date.now(), message: 'No session context' } as any)
          set({ feStatus: 'stopped' })
          return
        }

        const pricingConfig: PricingConfig | undefined = storeState.pricingConfig
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
        const { reactFlowToFlowDefinition } = await import('../../services/flowConversion.js')
        const flowDef = reactFlowToFlowDefinition(get().feNodes, get().feEdges, 'editor-current')

        const initArgs: any = {
          requestId,
          flowId: 'simple-chat',
          flowDef,
          initialContext: sessionContext,
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
        const { executeFlow } = await import('../../ipc/flows-v2/index.js')
        const { getWindow } = await import('../../core/window.js')
        const wc = getWindow()?.webContents
        await executeFlow(wc, initArgs)
      } catch (e) {
        console.error('[flowInit] executeFlow failed:', e)
        try {
          __queueFeEvent(set, get, { requestId, type: 'error', timestamp: Date.now(), message: String(e) } as any)
          set({ feStatus: 'stopped' })
        } catch {}
      }
    })

    // Return immediately so zubridge can ACK without waiting for execution
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

  feResume: async ({ userInput }: { userInput?: string }) => {
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

  feLoadTemplate: async ({ templateId }: { templateId: string }) => {
    try {
      // 0) Save current flow if dirty (best-effort; user profiles only)
      try {
        if (get().feHasUnsavedChanges) {
          await get().feSaveCurrentProfile()
        }
      } catch (e) {
        console.warn('[feLoadTemplate] Save-if-dirty failed (continuing):', e)
      }

      // 1) Stop current flow if running and wait for pending events to flush
      try {
        const curId = get().feRequestId
        if (curId) {
          await get().feStop()
          await __waitForFeSettle(1000)
        }
      } catch (e) {
        console.warn('[feLoadTemplate] Stop-and-settle failed (continuing):', e)
      }

      // 2) Load the requested template/profile
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

        // Clear previous run state, then auto-start the flow
        set({
          feStatus: 'stopped',
          feRequestId: null,
          feStreamingText: '',
          fePausedNode: null,
          feFlowState: {},
          feEvents: [],
          feLog: ''
        })

        try {
          const stateAny = get() as any
          if (stateAny.flowInit) {
            await stateAny.flowInit()
          }
        } catch (e) {
          console.error('[flowEditor] Auto-start after load failed:', e)
        }
      }
    } catch (error) {
      console.error('Error loading template:', error)
    }
  },


  // Create and save a new named flow with only the default entry
  feCreateNewFlowNamed: async ({ name }: { name: string }) => {
    try {
      const nameTrim = (name || '').trim()
      if (!nameTrim) return
      // Prevent duplicates across both user and system libraries
      try {
        const templates = await listFlowTemplates()
        const target = nameTrim.toLowerCase()
        const exists = (templates || []).some((t) => {
          const n = (t as any).name ? String((t as any).name).toLowerCase() : ''
          const id = (t as any).id ? String((t as any).id).toLowerCase() : ''
          return n === target || id === target
        })
        if (exists) {
          console.warn('[feCreateNewFlowNamed] Duplicate name refused:', nameTrim)
          return
        }
      } catch (e) {
        console.warn('[feCreateNewFlowNamed] Could not pre-check duplicates:', e)
      }
      const isSystem = await isSystemTemplate(nameTrim)
      if (isSystem) return

      const defaultNode = {
        id: 'defaultContextStart',
        type: 'hifiNode',
        data: {
          nodeType: 'defaultContextStart',
          label: 'Context Start',
          labelBase: 'Context Start',
          config: { systemInstructions: '' },
          expanded: true,
        },
        position: { x: -400, y: -150 },
      } as unknown as Node

      // Set state first so UI reflects immediately
      set({
        feNodes: [defaultNode],
        feEdges: [],
        feCurrentProfile: nameTrim,
        feSelectedTemplate: nameTrim,
        feHasUnsavedChanges: false,
        feFlowState: {},
        fePausedNode: null,
        feStatus: 'stopped',
        feEvents: [],
        feLog: '',
        feStreamingText: '',
        feActiveTools: new Set(),
      })

      // Persist and refresh template list
      const result = await saveFlowProfile([defaultNode], [], nameTrim, '')
      if (result?.success) {
        // Snapshot last-saved state
        const savedState = JSON.stringify({
          nodes: [{ id: defaultNode.id, nodeType: (defaultNode.data as any)?.nodeType, config: (defaultNode.data as any)?.config, position: defaultNode.position, expanded: (defaultNode.data as any)?.expanded }],
          edges: []
        })
        set({ feLastSavedState: savedState })

        // Update last used in workspace and session
        try {
          const settings = await loadWorkspaceSettings()
          settings.lastUsedFlow = nameTrim
          await saveWorkspaceSettings(settings)
        } catch (e) {
          console.error('[flowEditor] Failed to save last used flow (new):', e)
        }

        const storeState = get() as any
        if (storeState.updateCurrentSessionFlow) {
          await storeState.updateCurrentSessionFlow(nameTrim)
        }

        await get().feLoadTemplates()
      } else {
        console.error('[feCreateNewFlowNamed] Save failed:', result?.error)
      }
    } catch (err) {
      console.error('[feCreateNewFlowNamed] Error:', err)
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
    // Clear any existing module-level timeout and subscription
    if (__fePeriodicSaveTimeout) {
      clearTimeout(__fePeriodicSaveTimeout)
      __fePeriodicSaveTimeout = null
    }
    if (__fePeriodicSaveUnsubscribe) {
      __fePeriodicSaveUnsubscribe()
      __fePeriodicSaveUnsubscribe = null
    }

    // Subscribe to changes in nodes and edges
    __fePeriodicSaveUnsubscribe = store.subscribe(async (currentState: any, prevState: any) => {
      // Only watch nodes and edges for flow changes
      if (currentState.feNodes === prevState.feNodes && currentState.feEdges === prevState.feEdges) {
        return
      }

      const { feCurrentProfile } = currentState
      const profileToSave = feCurrentProfile // Only save to the active user profile; ignore selectedTemplate to avoid overwriting during pending selection/modal

      // Don't save system templates or when no active user profile
      if (!profileToSave) return
      const isSystem = await isSystemTemplate(profileToSave)
      if (isSystem) return

      // Debounce: clear existing timeout and set a new one
      if (__fePeriodicSaveTimeout) {
        clearTimeout(__fePeriodicSaveTimeout)
        __fePeriodicSaveTimeout = null
      }

      __fePeriodicSaveTimeout = setTimeout(async () => {
        const { feNodes, feEdges, feLastSavedState } = get()

        // Create snapshot of current state
        const snapshot = JSON.stringify({
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
        if (snapshot !== feLastSavedState) {
          try {
            const result = await saveFlowProfile(feNodes, feEdges, profileToSave, '')
            if (result.success) {
              set({ feLastSavedState: snapshot, feHasUnsavedChanges: false })
            }
          } catch (error) {
            console.error('[Auto-save] Error saving profile:', error)
          }
        }
      }, 1000) // 1 second debounce
    })
  },

  feStopPeriodicSave: () => {
    if (__fePeriodicSaveTimeout) {
      clearTimeout(__fePeriodicSaveTimeout)
      __fePeriodicSaveTimeout = null
    }
    if (__fePeriodicSaveUnsubscribe) {
      __fePeriodicSaveUnsubscribe()
      __fePeriodicSaveUnsubscribe = null
    }
  },

  feSaveAsProfile: async ({ name }: { name: string }) => {
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

  feDeleteProfile: async ({ name }: { name: string }) => {
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

  feSetSelectedTemplate: ({ id }: { id: string }) => set({ feSelectedTemplate: id }),
  feSetSaveAsModalOpen: ({ open }: { open: boolean }) => set({ feSaveAsModalOpen: open }),
  feSetNewProfileName: ({ name }: { name: string }) => set({ feNewProfileName: name }),
  feSetLoadTemplateModalOpen: ({ open }: { open: boolean }) => set({ feLoadTemplateModalOpen: open }),

  // ----- Flow Event Handlers -----
  // These are called by the flow scheduler in the main process
  // They update the UI state to reflect flow execution progress

  feHandleNodeStart: (nodeId: string) => {
    __queueFeFlowState(set, get, nodeId, {
      status: 'executing',
      cacheHit: false,
      style: {
        border: '3px solid #4dabf7',
        boxShadow: '0 0 20px rgba(77, 171, 247, 0.6), 0 0 40px rgba(77, 171, 247, 0.3)',
      },
    })

    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'nodeStart',
      nodeId,
      timestamp: Date.now(),
    })
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

    // Update node execution state (buffered)
    __queueFeFlowState(set, get, nodeId, {
      ...(get().feFlowState[nodeId] || {}),
      status: 'completed',
      cacheHit: false,
      style: {
        border: '2px solid #51cf66',
        boxShadow: '0 0 15px rgba(81, 207, 102, 0.4)',
      },
    })

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'nodeEnd',
      nodeId,
      durationMs,
      timestamp: Date.now(),
    })
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

    const currentState = get().feFlowState[nodeId] || {}
    __queueFeFlowState(set, get, nodeId, {
      ...currentState,
      status: st,
      cacheHit: isCacheHit ? true : currentState.cacheHit,
    })

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'io',
      nodeId,
      data,
      timestamp: Date.now(),
    })
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
    __queueFeActiveTools(set, get, activeTools)

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'toolStart',
      toolName,
      timestamp: Date.now(),
    })

    // Format badge label and metadata
    // Convert tool name to proper case (e.g., "fs.readFile" -> "FS.ReadFile")
    const formatToolName = (name: string): string => {
      const parts = name.split('.')
      return parts.map(part => {
        if (part.toLowerCase() === 'fs') return 'FS'
        // Capitalize first letter, keep rest as-is
        return part.charAt(0).toUpperCase() + part.slice(1)
      }).join('.')
    }

    let badgeLabel = formatToolName(toolName)
    let badgeMetadata: any = undefined

    if (toolArgs) {
      const normalizedToolName = toolName.replace(/\./g, '_')

      if (normalizedToolName === 'fs_read_file' || normalizedToolName === 'fs_write_file' ||
          normalizedToolName === 'fs_read_dir' || normalizedToolName === 'fs_create_dir') {
        const path = toolArgs.path || toolArgs.file_path || toolArgs.dir_path
        if (path) {
          badgeMetadata = { filePath: path }
        }
      } else if (normalizedToolName === 'index_search') {
        const query = toolArgs.query
        if (query) {
          badgeMetadata = {
            query: String(query).slice(0, 100),
            fullParams: toolArgs
          }
        }
      } else if (normalizedToolName === 'code_search_ast') {
        const pattern = toolArgs.pattern
        if (pattern) {
          const languages = toolArgs.languages && Array.isArray(toolArgs.languages) && toolArgs.languages.length
            ? ` [${toolArgs.languages.slice(0, 2).join(', ')}${toolArgs.languages.length > 2 ? '...' : ''}]`
            : ''
          badgeMetadata = {
            query: String(pattern).slice(0, 80) + languages,
            fullParams: toolArgs
          }
          // Store shallow, display-only params at a top-level map to avoid deep snapshot truncation in renderer bridges
          if (callId) {
            const sanitizedParams = {
              pattern: String(toolArgs.pattern || ''),
              languages: Array.isArray(toolArgs.languages) ? toolArgs.languages.map((s: any) => String(s)) : [],
              includeGlobs: Array.isArray(toolArgs.includeGlobs) ? toolArgs.includeGlobs.map((s: any) => String(s)) : [],
              excludeGlobs: Array.isArray(toolArgs.excludeGlobs) ? toolArgs.excludeGlobs.map((s: any) => String(s)) : [],
              maxMatches: typeof toolArgs.maxMatches === 'number' ? toolArgs.maxMatches : undefined,
              contextLines: typeof toolArgs.contextLines === 'number' ? toolArgs.contextLines : undefined,
            }
            set((state) => ({
              feToolParamsByKey: {
                ...(state as any).feToolParamsByKey,
                [callId]: sanitizedParams
              }
            }))
          }

        }
      } else if (normalizedToolName === 'workspace_search') {
        // Compact text-only rendering of inputs; no schema change, only UI formatting
        // Prefer queries[] if provided; otherwise, support a simple '|' delimited query string for display only
        const termsRaw: string[] = Array.isArray(toolArgs.queries) && toolArgs.queries.length
          ? toolArgs.queries
          : (typeof toolArgs.query === 'string' ? toolArgs.query.split('|') : [])

        const terms = termsRaw
          .map((s: any) => String(s || '').trim())
          .filter(Boolean)

        if (terms.length) {
          const shown = terms.slice(0, 2)  // Show max 2 queries in header
          const suffix = terms.length > 2 ? ` +${terms.length - 2}` : ''
          const mode = toolArgs.mode ? ` [${toolArgs.mode}]` : ''
          badgeMetadata = {
            query: shown.join(' | ') + suffix + mode,
            fullParams: toolArgs  // Store full params for expanded view
          }
        }

        // Store shallow, display-only params at a top-level map to avoid deep snapshot truncation in renderer bridges
        if (callId) {
          const f = (toolArgs && toolArgs.filters) || {}
          const sanitizedParams = {
            queries: terms,
            mode: String(toolArgs.mode || 'auto'),
            filters: {
              languages: Array.isArray(f.languages)
                ? f.languages.map((s: any) => String(s))
                : (typeof f.languages === 'string' ? [String(f.languages)] : []),
              pathsInclude: Array.isArray(f.pathsInclude) ? f.pathsInclude.map((s: any) => String(s)) : [],
              pathsExclude: Array.isArray(f.pathsExclude) ? f.pathsExclude.map((s: any) => String(s)) : [],
              maxResults: typeof f.maxResults === 'number' ? f.maxResults : undefined,
              maxSnippetLines: typeof f.maxSnippetLines === 'number' ? f.maxSnippetLines : undefined,
              timeBudgetMs: typeof f.timeBudgetMs === 'number' ? f.timeBudgetMs : undefined,
            }
          }
          set((state) => ({
            feToolParamsByKey: {
              ...(state as any).feToolParamsByKey,
              [callId]: sanitizedParams
            }
          }))
        }
      }
    }

    // Append tool badge to the node's execution box
    const node = get().feNodes.find(n => n.id === nodeId)
    if (!node) return

    const state = store.getState() as any
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
            timestamp: Date.now(),
            ...(badgeMetadata ? { metadata: badgeMetadata } : {})
          }
        },
        // Use provided provider/model from execution context, fallback to global if not provided
        provider: provider || state.selectedProvider,
        model: model || state.selectedModel
      })
    }
  },

  feHandleToolEnd: (toolName: string, callId?: string, nodeId?: string, result?: any) => {
    const activeTools = new Set(get().feActiveTools)
    activeTools.delete(toolName)
    __queueFeActiveTools(set, get, activeTools)

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'toolEnd',
      toolName,
      timestamp: Date.now(),
    })

    // Update badge status to success
    const state = store.getState() as any
    if (callId && nodeId && state.updateBadgeInNodeExecution) {
      const normalizedToolName = toolName.replace(/\./g, '_')

      // Handle index.search results
      if (normalizedToolName === 'index_search' && result && Array.isArray(result.chunks) && result.chunks.length) {
        // Store search results in unified cache using callId as key
        get().registerToolResult({ key: callId, data: result.chunks })

        state.updateBadgeInNodeExecution({
          nodeId,
          badgeId: callId,
          updates: {
            status: 'success',
            color: 'green',
            expandable: true,
            defaultExpanded: false,
            contentType: 'search' as const,
            metadata: {
              resultCount: result.chunks.length,
            },
            interactive: { type: 'search', data: { key: callId, count: result.chunks.length } }
          }
        })
        return
      }

      // Handle workspace.search results
      if (normalizedToolName === 'workspace_search' && result?.ok && result.data) {
        const resultData = result.data
        const resultCount = resultData.results?.length || 0

        // Store full result in unified cache
        get().registerToolResult({ key: callId, data: resultData })

        state.updateBadgeInNodeExecution({
          nodeId,
          badgeId: callId,
          updates: {
            status: 'success',
            color: 'green',
            expandable: true,
            defaultExpanded: false,
            contentType: 'workspace-search' as const,
            metadata: {
              resultCount,
            },
            interactive: { type: 'workspace-search', data: { key: callId, count: resultCount } }
          }
        })
        return
      }

      // Handle code.search_ast results
      if (normalizedToolName === 'code_search_ast' && result?.ok) {
        const matchCount = result.matches?.length || 0

        // Store full result in unified cache
        get().registerToolResult({ key: callId, data: result })

        state.updateBadgeInNodeExecution({
          nodeId,
          badgeId: callId,
          updates: {
            status: 'success',
            color: 'green',
            expandable: true,
            defaultExpanded: false,
            contentType: 'ast-search' as const,
            metadata: {
              resultCount: matchCount,
            },
            interactive: { type: 'ast-search', data: { key: callId, count: matchCount } }
          }
        })
        return
      }

      // Prefer pointer-based interactive payload to avoid large store payloads
      let interactive: any = undefined
      if (result && Array.isArray(result.fileEditsPreview) && result.fileEditsPreview.length) {
        // Compute total line additions/removals for summary pills
        const compute = (before?: string, after?: string) => {
          const a = (before ?? '').split(/\r?\n/)
          const b = (after ?? '').split(/\r?\n/)
          let i = 0, j = 0, added = 0, removed = 0
          while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { i++; j++; continue }
            if (i + 1 < a.length && a[i + 1] === b[j]) { removed++; i++; continue }
            if (j + 1 < b.length && a[i] === b[j + 1]) { added++; j++; continue }
            removed++; added++; i++; j++
          }
          if (i < a.length) removed += (a.length - i)
          if (j < b.length) added += (b.length - j)
          return { added, removed }
        }
        let totAdded = 0, totRemoved = 0
        for (const f of result.fileEditsPreview) {
          const { added, removed } = compute(f.before, f.after)
          totAdded += added
          totRemoved += removed
        }
        // Store in unified cache using callId as key
        get().registerToolResult({ key: callId, data: result.fileEditsPreview })
        interactive = { type: 'diff', data: { key: callId, count: result.fileEditsPreview.length } }
        state.updateBadgeInNodeExecution({
          nodeId,
          badgeId: callId,
          updates: {
            status: 'success',
            color: 'green',
            addedLines: totAdded,
            removedLines: totRemoved,
            filesChanged: result.fileEditsPreview.length,
            expandable: true,
            defaultExpanded: false,
            contentType: 'diff' as const,
            metadata: {
              fileCount: result.fileEditsPreview.length,
              // Show filename if only one file, otherwise show count
              filePath: result.fileEditsPreview.length === 1 ? result.fileEditsPreview[0].path : undefined,
            },
            ...(interactive ? { interactive } : {})
          }
        })
        return
      } else if (result && result.diffPreviewKey) {
        interactive = { type: 'diff', data: { key: result.diffPreviewKey, count: result.previewCount } }
      }
      state.updateBadgeInNodeExecution({
        nodeId,
        badgeId: callId,
        updates: {
          status: 'success',
          color: 'green',
          ...(interactive ? { interactive } : {})
        }
      })
    }
  },

  feHandleToolError: (toolName: string, error: string, callId?: string, nodeId?: string) => {
    const activeTools = new Set(get().feActiveTools)
    activeTools.delete(toolName)
    __queueFeActiveTools(set, get, activeTools)

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'toolError',
      toolName,
      error,
      timestamp: Date.now(),
    })

    // Update badge status to error
    const state = store.getState() as any
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
    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'intentDetected',
      nodeId,
      intent,
      provider,
      model,
      timestamp: Date.now(),
    })

    // Append intent badge to the node's execution box
    const node = get().feNodes.find(n => n.id === nodeId)
    if (!node) return

    const state = store.getState() as any
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

      // Record event (buffered)
      __queueFeEvent(set, get, {
        requestId: get().feRequestId || '',
        type: 'tokenUsage',
        provider,
        model,
        usage,
        timestamp: Date.now(),
      })

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

  feHandleRateLimitWait: (nodeId: string, attempt: number, waitMs: number, reason?: string, provider?: string, model?: string) => {
    if (!nodeId) return

    const state = store.getState() as any

    // Record event in non-persisted flow events (avoid mutating sessions)
    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'rateLimitWait',
      nodeId,
      data: { attempt, waitMs, reason, provider, model },
      timestamp: Date.now(),
    })

    // Add a badge to the node execution box
    const badgeId = `rate-limit-${nodeId}-${attempt}-${Date.now()}`
    const isProactive = attempt === 0
    const label = isProactive
      ? `⏳ Rate limit: waiting ${(waitMs / 1000).toFixed(1)}s...`
      : `⏳ Rate limited, retry ${attempt} in ${(waitMs / 1000).toFixed(1)}s...`

    if (state.appendToNodeExecution) {
      state.appendToNodeExecution({
        nodeId,
        nodeLabel: get().feNodes.find(n => n.id === nodeId)?.data?.label || 'Node',
        nodeKind: get().feNodes.find(n => n.id === nodeId)?.data?.nodeType || 'unknown',
        content: {
          type: 'badge',
          badge: {
            id: badgeId,
            label,
            color: 'yellow',
            variant: 'light',
            status: 'running',
          }
        },
        provider,
        model
      })
    }

    // Update badge after wait completes (optimistic - assumes wait will succeed)
    setTimeout(() => {
      if (state.updateBadgeInNodeExecution) {
        state.updateBadgeInNodeExecution({
          nodeId,
          badgeId,
          updates: {
            label: isProactive ? '✓ Rate limit wait complete' : `✓ Retry ${attempt} complete`,
            status: 'success',
            color: 'green'
          }
        })
      }
    }, waitMs)
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

    // Update node execution state to show it's waiting for input (buffered)
    set({ feStatus: 'waitingForInput', fePausedNode: nodeId, feStreamingText: '' })
    __queueFeFlowState(set, get, nodeId, {
      status: 'executing',  // Keep as executing since it's paused mid-execution
      style: {
        border: '3px solid #f59e0b',
        boxShadow: '0 0 20px rgba(245, 158, 11, 0.6), 0 0 40px rgba(245, 158, 11, 0.3)',
      },
    })

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: requestId,
      type: 'waitingForInput',
      nodeId,
      timestamp: Date.now(),
    })

    // Save flow state to session
    const state = store.getState() as any
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

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'done',
      timestamp: Date.now(),
    })

    // Clear flow state from session
    const state = store.getState() as any
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

    // Best-effort: flush any buffered UI updates now that we're done
    // Force a flush by scheduling with 0ms interval if there are pending buffers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(function immediateFlush(set: any, get: any) {
      if (!__feFlushTimer && (__fePendingEvents.length || Object.keys(__fePendingFlowState).length)) {
        __scheduleFeFlush(set, get, 0)
      }
    })(set, get)
  },

  feHandleError: (error: string) => {
    console.error('[flowEditor] Flow error:', error)
    set({ feStatus: 'stopped', feMainFlowContext: null, feIsolatedContexts: {} })

    // Record event (buffered)
    __queueFeEvent(set, get, {
      requestId: get().feRequestId || '',
      type: 'error',
      error,
      timestamp: Date.now(),
    })

    // Clear flow state from session
    const state = store.getState() as any
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
        __queueFeIsolatedContext(set, get, context.contextId, context)
      } else {
        // Update main context
        __queueFeMainContext(set, get, context)

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

