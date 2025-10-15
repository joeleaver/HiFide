import type { StateCreator } from 'zustand'
import type { Edge, Node, NodeChange, XYPosition } from 'reactflow'
import type { PricingConfig } from '../types'
import { initializeFlowProfiles, listFlowTemplates, loadFlowTemplate, saveFlowProfile, deleteFlowProfile, isSystemTemplate, type FlowTemplate } from '../../services/flowProfiles'

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
export type FlowStatus = 'idle' | 'running' | 'paused' | 'waitingForInput'

// Slice interface
export interface FlowEditorSlice {
  // Graph state
  feNodes: Node[]
  feEdges: Edge[]
  feNodePositions: Record<string, XYPosition>

  // Selection/UI state
  feSelectedNodeId: string | null

  // Run/watch state
  feRequestId: string | null
  feStatus: FlowStatus
  fePausedNode: string | null
  feEvents: FlowEvent[]
  feLog: string
  feLastExportMsg: string
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
  registerGlobalFlowEventHandler: () => void
  initFlowEditor: () => Promise<void>
  feLoadTemplates: () => Promise<void>
  feLoadTemplate: (templateId: string) => Promise<void>
  feSaveCurrentProfile: () => Promise<void>
  feStartPeriodicSave: () => void
  feStopPeriodicSave: () => void
  feSaveAsProfile: (name: string) => Promise<void>
  feDeleteProfile: (name: string) => Promise<void>
  feSetSelectedTemplate: (id: string) => void
  feSetSaveAsModalOpen: (open: boolean) => void
  feSetNewProfileName: (name: string) => void
  feSetLoadTemplateModalOpen: (open: boolean) => void
  feSetNodes: (nodesOrUpdater: Node[] | ((current: Node[]) => Node[])) => void
  feSetEdges: (edgesOrUpdater: Edge[] | ((current: Edge[]) => Edge[])) => void
  feApplyNodeChanges: (changes: NodeChange[]) => void
  feUpdateNodePosition: (id: string, pos: XYPosition) => void
  feAddNode: (kind: string, pos: XYPosition, label?: string) => void
  feSetSelectedNodeId: (id: string | null) => void
  feSetNodeLabel: (id: string, label: string) => void
  fePatchNodeConfig: (id: string, patch: Record<string, any>) => void

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
  feInit: () => Promise<void>
  feResumeFromState: (requestId: string) => Promise<void>
  feStop: () => Promise<void>
  feResume: (userInput?: string) => Promise<void>
  feExportTrace: () => Promise<void>
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

  feSelectedNodeId: null,

  feRequestId: null,
  feStatus: 'idle',
  fePausedNode: null,
  feEvents: [],
  feLog: '',
  feLastExportMsg: '',
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

  /**
   * Register global flow event handler
   * Called once at app startup, handles ALL flow events regardless of view
   */
  registerGlobalFlowEventHandler: () => {
    // Prevent double registration - use window to survive HMR
    if ((window as any).__fe_event_handler_registered) {
      console.log('[flowEditor] Event handler already registered, skipping')
      return
    }

    try {
      console.log('[flowEditor] Registering GLOBAL flow event listener...')
      console.log('[flowEditor] window.flowExec available:', !!(window as any).flowExec)
      console.log('[flowEditor] window.flowExec.onEvent available:', !!(window as any).flowExec?.onEvent)

      // Unregister old handler if it exists (from previous HMR)
      if ((window as any).__fe_off) {
        console.log('[flowEditor] Unregistering old event handler from HMR')
        try {
          ;(window as any).__fe_off()
        } catch (e) {
          console.warn('[flowEditor] Error unregistering old handler:', e)
        }
      }

      if (!(window as any).flowExec?.onEvent) {
        console.error('[flowEditor] window.flowExec.onEvent is not available! Cannot register event handler.')
        return
      }

      const off = (window as any).flowExec.onEvent((ev: FlowEvent) => {
        const reqId = get().feRequestId
        console.log('[flowEditor] Received flow event:', {
          type: ev.type,
          nodeId: ev.nodeId,
          receivedRequestId: ev.requestId,
          currentRequestId: reqId,
          hasText: !!(ev as any).text,
          textPreview: (ev as any).text?.substring?.(0, 20),
          storeInstanceId: (store as any).__storeId // Debug: verify we're using current store
        })

        // If this event is from a different flow, update our requestId to match
        // This handles cases where a new flow started but we didn't get notified
        if (reqId && ev.requestId !== reqId) {
          console.log('[flowEditor] RequestId changed - updating to match new flow:', { old: reqId, new: ev.requestId })
          set({ feRequestId: ev.requestId, feEvents: [], feStreamingText: '', feLog: '' })
        }

        // Log which handlers will be triggered
        if (ev.type === 'waitingForInput') {
          console.log('[flowEditor] waitingForInput event - will process handler')
        }

        // Add timestamp if not present
        if (!ev.timestamp) {
          ev.timestamp = Date.now()
        }

        // Handle IO events
        if (ev.type === 'io' && ev.nodeId && typeof ev.data === 'string') {
          const logEntry = `[${ev.nodeId}] ${ev.data}\n`
          set({ feLog: get().feLog + logEntry })

          // Derive status + cache badge on node
          const d = String(ev.data)
          let st: 'ok' | 'warn' | 'blocked' | 'masked' | undefined
          if (/\bblocked\b/i.test(d)) st = 'blocked'
          else if (/\bwarn/i.test(d)) st = 'warn'
          else if (/\bok\b/i.test(d)) st = 'ok'
          else if (/\bmasked\b/i.test(d)) st = 'masked'
          const isCacheHit = /\bcache-hit\b/i.test(d)
          set({
            feNodes: get().feNodes.map((n) => n.id === ev.nodeId ? {
              ...n,
              data: { ...(n.data as any), status: st, cacheHit: isCacheHit ? true : (n.data as any)?.cacheHit },
            } : n),
          })
        }

        // Handle node start
        if (ev.type === 'nodeStart' && ev.nodeId) {
          set({
            feNodes: get().feNodes.map((n) => (n.id === ev.nodeId ? {
              ...n,
              style: {
                border: '3px solid #4dabf7',
                boxShadow: '0 0 20px rgba(77, 171, 247, 0.6), 0 0 40px rgba(77, 171, 247, 0.3)',
              },
              data: {
                ...(n.data as any),
                status: 'executing',
                cacheHit: false,
                // Preserve detectedIntent from previous execution
                detectedIntent: (n.data as any)?.detectedIntent
              },
            } : n)),
          })
        }

        // Handle node end
        if (ev.type === 'nodeEnd' && ev.nodeId) {
          // Compute cost for chat node (check by node kind, not ID)
          let cost: number | undefined
          const node = get().feNodes.find(n => n.id === ev.nodeId)
          const isChat = node?.data?.kind === 'chat'

          if (isChat) {
            try {
              const provider = (store as any).getState().selectedProvider as string | null
              const model = (store as any).getState().selectedModel as string | null
              const pricingAll = (store as any).getState().pricingConfig as PricingConfig | undefined
              const p = provider && model ? (pricingAll as any)?.[provider]?.[model] : null
              if (p) {
                const inTok = Math.ceil((get().feInput || '').length / 4)
                const outTok = Math.ceil((get().feLog || '').length / 4)
                cost = (inTok / 1_000_000) * (p.inputCostPer1M || 0) + (outTok / 1_000_000) * (p.outputCostPer1M || 0)
              }
            } catch {}

            // Add assistant message to session when chat node completes
            const streamingText = get().feStreamingText
            if (streamingText) {
              console.log('[flowEditor] Chat node completed - adding assistant message to session:', streamingText.substring(0, 50))
              const state = store.getState() as any
              if (state.addAssistantMessage) {
                state.addAssistantMessage(streamingText)
                // Clear streaming text after adding to session
                set({ feStreamingText: '' })
              }
            }
          }
          set({
            feNodes: get().feNodes.map((n) => n.id === ev.nodeId ? {
              ...n,
              style: {
                border: '2px solid #10b981',
                boxShadow: 'none',
              },
              data: {
                ...(n.data as any),
                status: 'completed',
                durationMs: ev.durationMs,
                costUSD: typeof cost === 'number' ? cost : (n.data as any)?.costUSD,
                // Preserve detectedIntent if it exists
                detectedIntent: (n.data as any)?.detectedIntent
              },
            } : n),
            fePausedNode: get().fePausedNode === ev.nodeId ? null : get().fePausedNode,
          })
        }

        // Handle streaming chunks
        if (ev.type === 'chunk') {
          console.log('[flowEditor] Received chunk event:', { hasText: !!ev.text, textLength: ev.text?.length, text: ev.text })
          if (ev.text) {
            set({ feStreamingText: get().feStreamingText + ev.text })
          } else {
            console.warn('[flowEditor] Chunk event missing text field!')
          }
        }

        // Handle tool events
        if (ev.type === 'toolStart' && ev.toolName) {
          console.log('[flowEditor] Tool started:', ev.toolName)
          const activeTools = new Set(get().feActiveTools)
          activeTools.add(ev.toolName)
          console.log('[flowEditor] Active tools after start:', Array.from(activeTools))
          set({ feActiveTools: activeTools })

          // Add tool call to session
          const state = store.getState() as any
          if (state.addToolCall) {
            state.addToolCall(ev.toolName)
          }
        }

        if (ev.type === 'toolEnd' && ev.toolName) {
          console.log('[flowEditor] Tool ended:', ev.toolName)
          const activeTools = new Set(get().feActiveTools)
          activeTools.delete(ev.toolName)
          console.log('[flowEditor] Active tools after end:', Array.from(activeTools))
          set({ feActiveTools: activeTools })

          // Update tool call in session
          const state = store.getState() as any
          if (state.updateToolCall) {
            state.updateToolCall(ev.toolName, 'success')
          }
        }

        if (ev.type === 'toolError' && ev.toolName) {
          console.log('[flowEditor] Tool error:', ev.toolName, ev.error)
          const activeTools = new Set(get().feActiveTools)
          activeTools.delete(ev.toolName)
          console.log('[flowEditor] Active tools after error:', Array.from(activeTools))
          set({ feActiveTools: activeTools })

          // Update tool call in session with error
          const state = store.getState() as any
          if (state.updateToolCall) {
            state.updateToolCall(ev.toolName, 'error', ev.error)
          }
        }

        // Handle intent detection
        if (ev.type === 'intentDetected' && ev.nodeId && ev.intent) {
          console.log('[flowEditor] Intent detected:', ev.intent)

          // Store intent in session for display in chat
          const state = store.getState() as any
          if (state.setCurrentTurnIntent) {
            state.setCurrentTurnIntent(ev.intent)
          }
        }

        // Handle token usage
        if (ev.type === 'tokenUsage') {
          console.log('[flowEditor] Token usage event received:', {
            provider: ev.provider,
            model: ev.model,
            usage: ev.usage,
            hasProvider: !!ev.provider,
            hasModel: !!ev.model,
            hasUsage: !!ev.usage
          })

          if (ev.provider && ev.model && ev.usage) {
            // Record token usage in session
            const state = store.getState() as any
            console.log('[flowEditor] Calling recordTokenUsage, function exists:', !!state.recordTokenUsage)
            if (state.recordTokenUsage) {
              state.recordTokenUsage(ev.provider, ev.model, ev.usage)
              console.log('[flowEditor] Token usage recorded successfully')
            } else {
              console.error('[flowEditor] recordTokenUsage function not found in state!')
            }
          } else {
            console.warn('[flowEditor] Token usage event missing required fields:', {
              provider: ev.provider,
              model: ev.model,
              usage: ev.usage
            })
          }
        }

        // Handle waiting for input
        if (ev.type === 'waitingForInput' && ev.nodeId) {
          console.log('[flowEditor] Setting status to waitingForInput')

          // Flush streaming text to assistant message before pausing
          const streamingText = get().feStreamingText
          if (streamingText) {
            console.log('[flowEditor] Flushing streaming text to assistant message:', streamingText.substring(0, 50))
            const state = store.getState() as any
            if (state.addAssistantMessage) {
              state.addAssistantMessage(streamingText)
            }
          }

          // Update node styling to show it's waiting for input
          set({
            feStatus: 'waitingForInput',
            fePausedNode: ev.nodeId,
            feStreamingText: '',
            feNodes: get().feNodes.map((n) => (n.id === ev.nodeId ? {
              ...n,
              style: {
                border: '3px solid #f59e0b',
                boxShadow: '0 0 20px rgba(245, 158, 11, 0.6), 0 0 40px rgba(245, 158, 11, 0.3)',
              },
              data: { ...(n.data as any), status: 'waiting' },
            } : n)),
          })
          console.log('[flowEditor] Status after set:', get().feStatus)

          // Save flow state to session
          const state = store.getState() as any
          const currentSession = state.sessions?.find((s: any) => s.id === state.currentId)
          if (currentSession && state.saveCurrentSession) {
            // Update session with flow state
            const sessions = state.sessions.map((s: any) =>
              s.id === state.currentId
                ? {
                    ...s,
                    flowState: {
                      requestId: ev.requestId,
                      pausedAt: Date.now(),
                      pausedNodeId: ev.nodeId
                    },
                    updatedAt: Date.now()
                  }
                : s
            )
            ;(store as any).setState({ sessions })
            state.saveCurrentSession()
          }
        }

        // Handle done/error
        if (ev.type === 'done') {
          // WARNING: In a loop flow, 'done' should NEVER fire!
          // If we get here, the flow has unexpectedly terminated
          console.error('[flowEditor] UNEXPECTED: Flow completed with "done" event - loop flows should never complete!')
          console.error('[flowEditor] This indicates a serious problem with the flow structure')
          set({ feStatus: 'idle' })

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
        }

        // Handle error
        if (ev.type === 'error') {
          console.error('[flowEditor] Flow error:', ev.error)
          set({ feStatus: 'idle' })

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
        }

        // Add event to log
        set({ feEvents: [...get().feEvents, ev] })
      })

      // Mark as registered and store cleanup function on window (survives HMR)
      ;(window as any).__fe_event_handler_registered = true
      ;(window as any).__fe_off = off
      console.log('[flowEditor] Global event handler registered successfully')
    } catch (e) {
      console.error('[flowEditor] Failed to register event handler:', e)
    }
  },

  initFlowEditor: async () => {
    // Load available templates
    await get().feLoadTemplates()

    // Try to load last used flow for this workspace
    let loadedFromWorkspace = false
    try {
      const settingsResult = await window.workspace?.getSettings?.()
      if (settingsResult?.ok && settingsResult.settings?.lastUsedFlow) {
        const lastFlow = settingsResult.settings.lastUsedFlow
        console.log(`[flowEditor] Loading last used flow: ${lastFlow}`)

        const profile = await loadFlowTemplate(lastFlow)
        if (profile && profile.nodes && profile.edges) {
          set({
            feNodes: profile.nodes,
            feEdges: profile.edges,
            feCurrentProfile: isSystemTemplate(lastFlow) ? '' : lastFlow,
            feSelectedTemplate: lastFlow,  // Set selector to show loaded flow
          })
          loadedFromWorkspace = true
          console.log(`[flowEditor] Loaded last used flow: ${lastFlow}`)
          // Flow will be initialized by session initialization
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
          console.log(`[initFlowEditor] Loading default profile with ${profile.nodes.length} nodes and ${profile.edges.length} edges`)
          set({
            feNodes: profile.nodes,
            feEdges: profile.edges,
            feSelectedTemplate: 'default',  // Set selector to show default flow
          })
          // Flow will be initialized by session initialization
        } else {
          console.warn('[initFlowEditor] No default profile found or invalid profile')
        }
      } catch (error) {
        console.error('Failed to load flow profile:', error)
      }
    }

    // Load persisted state via IPC (renderer <-> main)
    try {
      const res = await (window as any).flowState?.load?.()
      const st = res?.state || {}
      const patch: Partial<FlowEditorSlice> = {}
      if (typeof st.redactorEnabled === 'boolean') patch.feRedactorEnabled = st.redactorEnabled
      if (typeof st.ruleEmails === 'boolean') patch.feRuleEmails = st.ruleEmails
      if (typeof st.ruleApiKeys === 'boolean') patch.feRuleApiKeys = st.ruleApiKeys
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
        set({ feNodes: get().feNodes.map((n) => st.nodePositions[n.id] ? { ...n, position: st.nodePositions[n.id] } : n) })
      }
      if (st.nodeLabels && typeof st.nodeLabels === 'object') {
        set({ feNodes: get().feNodes.map((n) => {
          const lbl = (st.nodeLabels as any)[n.id]
          return lbl ? { ...n, data: { ...(n.data as any), labelBase: lbl, label: lbl } } : n
        }) })
      }
      if (st.nodeConfigs && typeof st.nodeConfigs === 'object') {
        set({ feNodes: get().feNodes.map((n) => {
          const cfg = (st.nodeConfigs as any)[n.id]
          return cfg ? { ...n, data: { ...(n.data as any), config: cfg } } : n
        }) })
      }
      set(patch)
    } catch {}

    // Event handler is now registered globally in registerGlobalFlowEventHandler
    // No need to register it here

    // Persistence subscription (debounced)
    const save = debounce(() => {
      try {
        const s = get()
        const nodeLabels = Object.fromEntries(s.feNodes.map((n) => [n.id, ((n.data as any)?.labelBase || n.id)]))
        const nodeConfigs = Object.fromEntries(s.feNodes.map((n) => [n.id, ((n.data as any)?.config || {})]))
        ;(window as any).flowState?.save?.({
          redactorEnabled: s.feRedactorEnabled,
          ruleEmails: s.feRuleEmails,
          ruleApiKeys: s.feRuleApiKeys,
          ruleAwsKeys: s.feRuleAwsKeys,
          ruleNumbers16: s.feRuleNumbers16,
          budgetUSD: s.feBudgetUSD,
          budgetBlock: s.feBudgetBlock,
          errorDetectEnabled: s.feErrorDetectEnabled,
          errorDetectBlock: s.feErrorDetectBlock,
          selectedProvider: (store as any).getState().selectedProvider,
          nodePositions: s.feNodePositions,
          nodeLabels,
          nodeConfigs,
          errorDetectPatterns: s.feErrorDetectPatterns,
          retryAttempts: s.feRetryAttempts,
          retryBackoffMs: s.feRetryBackoffMs,
          cacheEnabled: s.feCacheEnabled,
        })
      } catch {}
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

    // Start periodic save
    get().feStartPeriodicSave()
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
      // Prevent deletion of defaultContextStart node
      if ((ch as any).type === 'remove' && (ch as any).id) {
        const node = map.get((ch as any).id)
        if (node && (node.data as any)?.kind === 'defaultContextStart') {
          console.warn('Cannot delete the defaultContextStart node. It is the required entry point.')
          continue
        }
        map.delete((ch as any).id)
      } else if ((ch as any).type === 'position' && (ch as any).id) {
        const n = map.get((ch as any).id)
        if (n) map.set(n.id, { ...n, position: (ch as any).position })
      }
    }
    set({ feNodes: Array.from(map.values()) })
  },
  feUpdateNodePosition: (id, pos) => {
    set({
      feNodePositions: { ...get().feNodePositions, [id]: pos },
      feNodes: get().feNodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
    })
  },
  feAddNode: (kind, pos, label) => {
    // Prevent adding multiple defaultContextStart nodes
    if (kind === 'defaultContextStart') {
      const hasDefaultContextStart = get().feNodes.some(n => (n.data as any)?.kind === 'defaultContextStart')
      if (hasDefaultContextStart) {
        console.warn('Cannot add multiple defaultContextStart nodes. There can only be one entry point.')
        return
      }
    }

    const id = `${kind}-${Date.now()}`
    const lbl = label || kind
    set({
      feNodes: [
        ...get().feNodes,
        { id, type: 'hifiNode', data: { kind, label: lbl, labelBase: lbl }, position: pos },
      ],
    })
  },
  feSetSelectedNodeId: (id) => set({ feSelectedNodeId: id }),
  feSetNodeLabel: (id, label) => {
    const updatedNodes = get().feNodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), labelBase: label, label } } : n))
    set({ feNodes: updatedNodes })
  },
  fePatchNodeConfig: (id, patch) => {
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
      // Fallback to IPC helper
      ;(async () => {
        try {
          const res = await (window as any).models?.cheapestClassifier?.(provider)
          set({ feResolvedModel: res?.ok ? (res.model || null) : null })
        } catch { set({ feResolvedModel: null }) }
      })()
    } catch { set({ feResolvedModel: null }) }
  },

  feInit: async () => {
    // Initialize flow - execute nodes up to first userInput

    // Check if flow is loaded
    if (get().feNodes.length === 0) {
      console.warn('[feInit] Flow not loaded yet, skipping initialization')
      return
    }

    const requestId = `flow-init-${Date.now()}`
    console.log('[feInit] Setting requestId:', requestId)
    console.trace('[feInit] Called from:')

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
    console.log('[feInit] RequestId set in store:', get().feRequestId)

    const storeState: any = (store as any).getState()
    const selectedProvider: string | null = storeState.selectedProvider
    const selectedModel: string | null = storeState.selectedModel
    const pricingConfig: PricingConfig | undefined = storeState.pricingConfig
    const modelPricing = (pricingConfig as any)?.[selectedProvider || '']?.[selectedModel || ''] || null

    const rules: string[] = []
    if (get().feRuleEmails) rules.push('emails')
    if (get().feRuleApiKeys) rules.push('apiKeys')
    if (get().feRuleAwsKeys) rules.push('awsKeys')
    if (get().feRuleNumbers16) rules.push('numbers16')
    const maxUSD = (() => { const v = parseFloat(get().feBudgetUSD); return isNaN(v) ? undefined : v })()

    const flowDef = {
      id: 'editor-current',
      nodes: get().feNodes.map((n) => ({ id: n.id, type: (n.data as any)?.kind, config: (n.data as any)?.config || {} })),
      edges: get().feEdges.map((e) => ({
        id: (e.id || `${e.source}-${e.target}`),
        source: e.source,
        target: e.target,
        sourceHandle: (e as any)?.sourceHandle,
        targetHandle: (e as any)?.targetHandle,
        label: (e as any)?.label
      })),
    }

    console.log('[feInit] Flow definition:', {
      nodeCount: flowDef.nodes.length,
      edgeCount: flowDef.edges.length,
      nodes: flowDef.nodes.map(n => ({ id: n.id, type: n.type })),
      edges: flowDef.edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }))
    })

    const initArgs: any = {
      requestId,
      flowId: 'simple-chat',
      provider: selectedProvider,
      model: selectedModel || undefined,
      flowDef,
      policy: {
        autoApproveEnabled: storeState.autoApproveEnabled,
        autoApproveThreshold: storeState.autoApproveThreshold,
        redactor: { enabled: get().feRedactorEnabled, rules },
        budgetGuard: { maxUSD, blockOnExceed: get().feBudgetBlock },
        errorDetection: { enabled: get().feErrorDetectEnabled, blockOnFlag: get().feErrorDetectBlock, patterns: (get().feErrorDetectPatterns || '').split(/[\n,]/g).map((s) => s.trim()).filter(Boolean) },
        pricing: modelPricing ? { inputCostPer1M: modelPricing.inputCostPer1M, outputCostPer1M: modelPricing.outputCostPer1M } : undefined,
      },
    }

    // V2: Use run instead of init (init is deprecated)
    console.log('[feInit] Running flow with V2 engine:', initArgs)
    const result = await (window as any).flowExec?.run?.(initArgs)
    console.log('[feInit] Flow result:', result)

    // Flow will pause at userInput automatically in V2
    // The pause state will be set by flow:event handlers
  },

  /**
   * Resume flow execution from saved state
   * Used when loading a session with a paused flow
   */
  feResumeFromState: async (savedRequestId: string) => {
    console.log('[feResumeFromState] Resuming flow with requestId:', savedRequestId)

    // Check if flow is loaded
    if (get().feNodes.length === 0) {
      console.warn('[feResumeFromState] Flow not loaded yet, skipping resumption')
      return
    }

    // Restore the saved requestId
    set({
      feRequestId: savedRequestId,
      feStatus: 'waitingForInput',
      feStreamingText: ''
    })
    console.log('[feResumeFromState] RequestId restored:', get().feRequestId)

    // The flow is already paused at a userInput node
    // User can resume it by calling feResume(userInput)
    console.log('[feResumeFromState] Flow state restored, waiting for user input')
  },

  feClearLogs: () => {
    set({ feLog: '', feEvents: [], feStreamingText: '' })
  },

  feRun: async () => {
    set({ feLog: '', feEvents: [], feStreamingText: '' })
    const requestId = `flow-${Date.now()}`
    set({ feRequestId: requestId, feStatus: 'running' })

    const storeState: any = (store as any).getState()
    const selectedProvider: string | null = storeState.selectedProvider
    const selectedModel: string | null = storeState.selectedModel
    const pricingConfig: PricingConfig | undefined = storeState.pricingConfig
    const modelPricing = (pricingConfig as any)?.[selectedProvider || '']?.[selectedModel || ''] || null

    const rules: string[] = []
    if (get().feRuleEmails) rules.push('emails')
    if (get().feRuleApiKeys) rules.push('apiKeys')
    if (get().feRuleAwsKeys) rules.push('awsKeys')
    if (get().feRuleNumbers16) rules.push('numbers16')
    const maxUSD = (() => { const v = parseFloat(get().feBudgetUSD); return isNaN(v) ? undefined : v })()

    const flowDef = {
      id: 'editor-current',
      nodes: get().feNodes.map((n) => ({ id: n.id, kind: (n.data as any)?.kind, config: (n.data as any)?.config || {} })),
      edges: get().feEdges.map((e) => ({
        id: (e.id || `${e.source}-${e.target}`),
        source: e.source,
        target: e.target,
        sourceHandle: (e as any)?.sourceHandle,
        targetHandle: (e as any)?.targetHandle,
        label: (e as any)?.label
      })),
    }

    const runArgs: any = {
      requestId,
      flowId: 'simple-chat',
      input: get().feInput,
      provider: selectedProvider,
      model: selectedModel || undefined,
      flowDef,
      _retryPolicy: { maxAttempts: Math.max(1, Number(get().feRetryAttempts || 1)), backoffMs: Math.max(0, Number(get().feRetryBackoffMs || 0)) },
      _cachePolicy: { enabled: !!get().feCacheEnabled },
      policy: {
        autoApproveEnabled: storeState.autoApproveEnabled,
        autoApproveThreshold: storeState.autoApproveThreshold,
        redactor: { enabled: get().feRedactorEnabled, rules },
        budgetGuard: { maxUSD, blockOnExceed: get().feBudgetBlock },
        errorDetection: { enabled: get().feErrorDetectEnabled, blockOnFlag: get().feErrorDetectBlock, patterns: (get().feErrorDetectPatterns || '').split(/[\n,]/g).map((s) => s.trim()).filter(Boolean) },
        pricing: modelPricing ? { inputCostPer1M: modelPricing.inputCostPer1M, outputCostPer1M: modelPricing.outputCostPer1M } : undefined,
      },
    }

    await (window as any).flowExec?.run?.(runArgs)
  },

  feStop: async () => {
    const id = get().feRequestId
    if (id) await (window as any).flowExec?.stop?.(id)
    set({ feStatus: 'idle' })
  },

  feResume: async (userInput?: string) => {
    const id = get().feRequestId
    console.log('[feResume] Called with requestId:', id, 'userInput:', userInput?.substring(0, 50))
    console.trace('[feResume] Called from:')
    if (!id) {
      console.error('[feResume] No requestId found!')
      return
    }

    // Add user message to session
    if (userInput) {
      const state = store.getState() as any
      if (state.addUserMessage) {
        state.addUserMessage(userInput)
      }
    }

    // Update state for new execution
    // Note: Don't clear feStreamingText here - it should already be cleared by the chat node handler
    set({ feStatus: 'running' })

    const result = await (window as any).flowExec?.resume?.(id, userInput)
    console.log('[feResume] Resume result:', result)
  },

  feExportTrace: async () => {
    try {
      const res = await (window as any).flowTrace?.export?.(get().feEvents, 'flow-run')
      if (res?.ok) set({ feLastExportMsg: `Trace saved: ${res.file}` })
      else set({ feLastExportMsg: `Export failed${res?.error ? `: ${res.error}` : ''}` })
    } catch (e: any) {
      set({ feLastExportMsg: `Export failed: ${String(e?.message || e)}` })
    }
  },

  // ----- Template Management Actions -----
  feLoadTemplates: async () => {
    try {
      const templates = await listFlowTemplates()
      console.log('Loaded templates:', templates)
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
      console.log('[feLoadTemplate] Loading template:', templateId)
      console.trace('[feLoadTemplate] Called from:')
      const profile = await loadFlowTemplate(templateId)
      if (profile && profile.nodes && profile.edges) {
        // Create snapshot of loaded state
        const loadedState = JSON.stringify({
          nodes: profile.nodes.map(n => ({
            id: n.id,
            kind: (n.data as any)?.kind,
            config: (n.data as any)?.config,
            position: n.position,
            expanded: (n.data as any)?.expanded
          })),
          edges: profile.edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (e as any)?.sourceHandle,
            targetHandle: (e as any)?.targetHandle
          }))
        })

        set({
          feNodes: profile.nodes,
          feEdges: profile.edges,
          feCurrentProfile: isSystemTemplate(templateId) ? '' : templateId,
          feSelectedTemplate: templateId,  // Update selector to show loaded template
          feHasUnsavedChanges: false,
          feLastSavedState: loadedState,
        })
        console.log(`Loaded template: ${templateId}`)

        // Save as last used flow for this workspace
        try {
          await window.workspace?.setSetting?.('lastUsedFlow', templateId)
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
        console.log('[feLoadTemplate] Initializing new flow...')

        // Fire and forget - don't block on flow initialization
        setTimeout(() => {
          void get().feInit()
        }, 100)
      }
    } catch (error) {
      console.error('Error loading template:', error)
    }
  },

  feSaveCurrentProfile: async () => {
    const { feCurrentProfile, feNodes, feEdges } = get()
    if (!feCurrentProfile || isSystemTemplate(feCurrentProfile)) {
      console.warn('Cannot save: no current profile or trying to save system template')
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
        console.log(`Saved profile: ${feCurrentProfile}`)
      } else {
        console.error('Save failed:', result.error)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    }
  },

  feStartPeriodicSave: (() => {
    let saveTimeout: NodeJS.Timeout | null = null
    let unsubscribe: (() => void) | null = null

    return () => {
      // Clear any existing timeout and subscription
      if (saveTimeout) {
        clearTimeout(saveTimeout)
        saveTimeout = null
      }
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }

      // Subscribe to changes in nodes and edges
      unsubscribe = (store as any).subscribe((state: any, prevState: any) => {
        // Only watch nodes and edges for flow changes
        if (state.feNodes === prevState.feNodes && state.feEdges === prevState.feEdges) {
          return
        }

        const { feCurrentProfile, feSelectedTemplate } = state
        const profileToSave = feCurrentProfile || feSelectedTemplate

        // Don't save system templates
        if (!profileToSave || isSystemTemplate(profileToSave)) {
          return
        }

        // Debounce: clear existing timeout and set a new one
        if (saveTimeout) {
          clearTimeout(saveTimeout)
        }

        saveTimeout = setTimeout(async () => {
          const { feNodes, feEdges, feLastSavedState } = get()

          // Create snapshot of current state
          const currentState = JSON.stringify({
            nodes: feNodes.map(n => ({
              id: n.id,
              kind: (n.data as any)?.kind,
              config: (n.data as any)?.config,
              position: n.position,
              expanded: (n.data as any)?.expanded
            })),
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
                console.log(`[Auto-save] Saved profile: ${profileToSave}`)
              }
            } catch (error) {
              console.error('[Auto-save] Error saving profile:', error)
            }
          }
        }, 1000) // 1 second debounce
      })
    }
  })(),

  feStopPeriodicSave: (() => {
    // This will be set by feStartPeriodicSave
    return () => {
      // Cleanup is handled in feStartPeriodicSave when it's called again
    }
  })(),

  feSaveAsProfile: async (name: string) => {
    const { feNodes, feEdges } = get()
    if (!name || isSystemTemplate(name)) {
      console.warn('Invalid profile name or conflicts with system template')
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
        console.log(`Saved new profile: ${name}`)
      } else {
        console.error('Save As failed:', result.error)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    }
  },

  feDeleteProfile: async (name: string) => {
    if (!name || isSystemTemplate(name)) {
      console.warn('Cannot delete: invalid name or system template')
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
        console.log(`Deleted profile: ${name}`)
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
})

