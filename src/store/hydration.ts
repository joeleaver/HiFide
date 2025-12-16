/**
 * Unified Hydration State Machine - Renderer Store
 * 
 * Single source of truth for application hydration state.
 * Replaces multiple scattered boolean flags with a state machine.
 */

import { create } from 'zustand'
import type { HydrationPhase, WorkspaceSnapshot } from '../../shared/hydration'
import { PHASE_MESSAGES, isLoadingPhase, HYDRATION_TIMEOUTS } from '../../shared/hydration'
import { getBackendClient } from '../lib/backend/bootstrap'

export interface HydrationState {
  // Current phase of the state machine
  phase: HydrationPhase
  // When the current phase started
  phaseSince: number
  // Error message if phase is 'error'
  error: string | null
  // The current workspace snapshot (null until received)
  snapshot: WorkspaceSnapshot | null
  // Whether we're showing the loading overlay (derived from phase)
  isLoading: boolean
  // Human-readable message for the loading overlay
  loadingMessage: string | null
  // Safety timeout ID
  safetyTimeoutId: ReturnType<typeof setTimeout> | null
  
  // Actions
  setPhase: (phase: HydrationPhase, error?: string) => void
  applySnapshot: (snapshot: WorkspaceSnapshot) => void
  reset: () => void
  
  // Internal
  _startSafetyTimeout: () => void
  _clearSafetyTimeout: () => void
}

function createHydrationStore() {
  return create<HydrationState>((set, get) => ({
    phase: 'disconnected',
    phaseSince: Date.now(),
    error: null,
    snapshot: null,
    isLoading: false,
    loadingMessage: PHASE_MESSAGES.disconnected,
    safetyTimeoutId: null,
    
    setPhase: (phase, error) => {
      const now = Date.now()
      const isLoading = isLoadingPhase(phase)
      const loadingMessage = PHASE_MESSAGES[phase]
      
      console.log(`[hydration] Phase transition: ${get().phase} → ${phase}`)
      
      set({
        phase,
        phaseSince: now,
        error: error || null,
        isLoading,
        loadingMessage,
      })
      
      // Manage safety timeout
      if (isLoading) {
        get()._startSafetyTimeout()
      } else {
        get()._clearSafetyTimeout()
      }
    },
    
    applySnapshot: (snapshot) => {
      console.log('[hydration] Applying workspace snapshot:', {
        workspaceId: snapshot.workspaceId,
        sessionCount: snapshot.sessions.length,
        currentSessionId: snapshot.currentSessionId,
        timelineItems: snapshot.timeline.length,
      })

      set({ snapshot })

      // Hydrate all dependent stores from the snapshot (async, fire-and-forget)
      hydrateStoresFromSnapshot(snapshot).catch((err) => {
        console.error('[hydration] Failed to hydrate stores from snapshot:', err)
      })
    },
    
    reset: () => {
      get()._clearSafetyTimeout()
      set({
        phase: 'disconnected',
        phaseSince: Date.now(),
        error: null,
        snapshot: null,
        isLoading: false,
        loadingMessage: PHASE_MESSAGES.disconnected,
      })
    },
    
    _startSafetyTimeout: () => {
      const existing = get().safetyTimeoutId
      if (existing) clearTimeout(existing)
      
      const timeoutId = setTimeout(() => {
        const state = get()
        if (state.isLoading) {
          console.warn(`[hydration] Safety timeout triggered after ${HYDRATION_TIMEOUTS.TOTAL_MS}ms. Phase: ${state.phase}`)
          set({
            phase: 'ready', // Force to ready state
            isLoading: false,
            loadingMessage: null,
            error: `Timeout waiting for ${state.phase}`,
          })
        }
      }, HYDRATION_TIMEOUTS.TOTAL_MS)
      
      set({ safetyTimeoutId: timeoutId })
    },
    
    _clearSafetyTimeout: () => {
      const existing = get().safetyTimeoutId
      if (existing) {
        clearTimeout(existing)
        set({ safetyTimeoutId: null })
      }
    },
  }))
}

/**
 * Hydrate all dependent stores from a workspace snapshot.
 * This is called once when the snapshot is received.
 */
async function hydrateStoresFromSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  // Import stores dynamically to avoid circular deps
  // Each store will be hydrated with its relevant portion of the snapshot

  try {
    // Session UI store
    const { useSessionUi } = await import('./sessionUi')
    console.log('[hydration] Hydrating sessionUi with:', {
      sessions: snapshot.sessions.length,
      currentSessionId: snapshot.currentSessionId,
      meta: snapshot.meta,
      flows: snapshot.flowEditor.templates.length,
      providerValid: snapshot.settings.providerValid,
      modelsByProvider: Object.keys(snapshot.settings.modelsByProvider),
    })
    useSessionUi.getState().__setSessions(snapshot.sessions, snapshot.currentSessionId)
    useSessionUi.getState().__setMeta(snapshot.meta)
    useSessionUi.getState().__setUsage(snapshot.usage.tokenUsage, snapshot.usage.costs, snapshot.usage.requestsLog)
    // Apply defaultPricingConfig before models so renderer-side clamping uses
    // the canonical allowlist from defaultModelSettings.json.
    useSessionUi.getState().__setDefaultPricingConfig(snapshot.settings.defaultPricingConfig)
    useSessionUi.getState().__setSettings(snapshot.settings.providerValid, snapshot.settings.modelsByProvider)
    useSessionUi.getState().__setFlows(snapshot.flowEditor.templates)
    console.log('[hydration] sessionUi hydrated, current state:', {
      flows: useSessionUi.getState().flows.length,
      executedFlowId: useSessionUi.getState().executedFlowId,
      providerId: useSessionUi.getState().providerId,
      modelId: useSessionUi.getState().modelId,
    })
  } catch (e) {
    console.warn('[hydration] Failed to hydrate sessionUi:', e)
  }

  try {
    // Chat timeline store
    const { useChatTimeline } = await import('./chatTimeline')
    useChatTimeline.getState().hydrateFromSession(snapshot.timeline)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate chatTimeline:', e)
  }

  try {
    // Flow editor store
    const { useFlowEditor } = await import('./flowEditor')
    useFlowEditor.getState().setTemplates(
      snapshot.flowEditor.templates,
      true,
      snapshot.flowEditor.selectedTemplate
    )
    // Also hydrate the current graph
    const nodes = Array.isArray(snapshot.flowEditor.nodes) ? snapshot.flowEditor.nodes : []
    const edges = Array.isArray(snapshot.flowEditor.edges) ? snapshot.flowEditor.edges : []
    try {
      const { useFlowEditorLocal } = await import('./flowEditorLocal')
      useFlowEditorLocal.setState({ nodes, edges, isHydrated: true })
    } catch (innerErr) {
      console.warn('[hydration] Failed to hydrate flowEditorLocal graph snapshot:', innerErr)
    }
  } catch (e) {
    console.warn('[hydration] Failed to hydrate flowEditor:', e)
  }

  try {
    // Flow contexts store
    const { useFlowContexts } = await import('./flowContexts')
    useFlowContexts.getState().setContexts(snapshot.flowContexts)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate flowContexts:', e)
  }

  try {
    // Kanban store
    const { useKanban } = await import('./kanban')
    useKanban.getState().setBoard(snapshot.kanban.board)
    useKanban.getState().setLoading(false)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate kanban:', e)
  }

  try {
    // Knowledge base store
    const { useKnowledgeBase } = await import('./knowledgeBase')
    useKnowledgeBase.getState().setItemsMap(snapshot.knowledgeBase.items)
    useKnowledgeBase.getState().setWorkspaceFiles(snapshot.knowledgeBase.files)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate knowledgeBase:', e)
  }

  try {
    // Backend binding store
    const { useBackendBinding } = await import('./binding')
    useBackendBinding.getState().setBinding({
      workspaceId: snapshot.workspaceId,
      root: snapshot.workspaceRoot,
      attached: true,
    })
  } catch (e) {
    console.warn('[hydration] Failed to hydrate binding:', e)
  }
}

// HMR reuse pattern
const hotData: any = (import.meta as any).hot?.data || {}
const __hydrationStore: any = hotData.hydrationStore || createHydrationStore()
export const useHydration = __hydrationStore
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => { data.hydrationStore = __hydrationStore })
}

/**
 * Initialize hydration event subscriptions.
 * Call this once when the backend client is ready.
 */
export function initHydrationEvents(): void {
  const client = getBackendClient()
  if (!client) {
    console.warn('[hydration] No backend client available')
    return
  }

  console.log('[hydration] Initializing event subscriptions')

  // Phase change notifications from main process
  client.subscribe('hydration.phase', (params: { phase: HydrationPhase; since: number }) => {
    console.log('[hydration] Received phase notification:', params.phase)
    useHydration.getState().setPhase(params.phase)
  })

  // Complete workspace snapshot
  client.subscribe('workspace.snapshot', (snapshot: WorkspaceSnapshot) => {
    console.log('[hydration] Received workspace snapshot:', {
      workspaceId: snapshot.workspaceId,
      sessions: snapshot.sessions.length,
      currentSessionId: snapshot.currentSessionId,
      meta: snapshot.meta,
      flows: snapshot.flowEditor.templates.length,
    })
    useHydration.getState().applySnapshot(snapshot)
    // Don't transition to ready here - wait for loading.complete event
  })

  // Error notification
  client.subscribe('hydration.error', (params: { phase: HydrationPhase; error: string }) => {
    console.error('[hydration] Received error:', params.error)
    useHydration.getState().setPhase('error', params.error)
  })

  // Workspace attached - start loading phase
  client.subscribe('workspace.attached', () => {
    const phase = useHydration.getState().phase
    console.log('[hydration] workspace.attached received, current phase:', phase)
    if (phase === 'connected') {
      useHydration.getState().setPhase('loading')
    }
  })

  // Loading complete - all data has been streamed, transition to ready
  client.subscribe('loading.complete', () => {
    console.log('[hydration] loading.complete received, transitioning to ready')
    useHydration.getState().setPhase('ready')
  })

  // Set initial phase to 'connecting' - the WebSocket is about to connect
  // The 'connected' transition happens in the onOpen callback in bootstrap.ts
  useHydration.getState().setPhase('connecting')
}

/**
 * Call this when session hydration is complete (from sessionUi.runOnce).
 * This bridges the old hydration system with the new state machine.
 */
export function markHydrationReady(): void {
  const phase = useHydration.getState().phase
  console.log('[hydration] markHydrationReady called, current phase:', phase)
  if (phase === 'loading' || phase === 'connecting' || phase === 'connected' || phase === 'binding') {
    useHydration.getState().setPhase('ready')
  }
}

