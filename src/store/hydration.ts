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
      
      // Hydrate all dependent stores from the snapshot
      hydrateStoresFromSnapshot(snapshot)
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
function hydrateStoresFromSnapshot(snapshot: WorkspaceSnapshot): void {
  // Import stores dynamically to avoid circular deps
  // Each store will be hydrated with its relevant portion of the snapshot
  
  try {
    // Session UI store
    const { useSessionUi } = require('./sessionUi')
    useSessionUi.getState().__setSessions(snapshot.sessions, snapshot.currentSessionId)
    useSessionUi.getState().__setMeta(snapshot.meta)
    useSessionUi.getState().__setUsage(snapshot.usage.tokenUsage, snapshot.usage.costs, snapshot.usage.requestsLog)
    useSessionUi.getState().__setSettings(snapshot.settings.providerValid, snapshot.settings.modelsByProvider)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate sessionUi:', e)
  }
  
  try {
    // Chat timeline store  
    const { useChatTimeline } = require('./chatTimeline')
    useChatTimeline.getState().hydrateFromSession(snapshot.timeline)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate chatTimeline:', e)
  }
  
  try {
    // Flow editor store
    const { useFlowEditor } = require('./flowEditor')
    useFlowEditor.getState().setTemplates(
      snapshot.flowEditor.templates,
      true,
      snapshot.flowEditor.selectedTemplate
    )
  } catch (e) {
    console.warn('[hydration] Failed to hydrate flowEditor:', e)
  }
  
  try {
    // Kanban store
    const { useKanban } = require('./kanban')
    useKanban.getState().setBoard(snapshot.kanban.board)
    useKanban.getState().setLoading(false)
  } catch (e) {
    console.warn('[hydration] Failed to hydrate kanban:', e)
  }

  try {
    // Backend binding store
    const { useBackendBinding } = require('./binding')
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

  // Complete workspace snapshot (future - not currently sent by main)
  client.subscribe('workspace.snapshot', (snapshot: WorkspaceSnapshot) => {
    console.log('[hydration] Received workspace snapshot')
    useHydration.getState().applySnapshot(snapshot)
    // Transition to ready after applying snapshot
    useHydration.getState().setPhase('ready')
  })

  // Error notification
  client.subscribe('hydration.error', (params: { phase: HydrationPhase; error: string }) => {
    console.error('[hydration] Received error:', params.error)
    useHydration.getState().setPhase('error', params.error)
  })

  // Workspace binding notification (start loading phase)
  client.subscribe('workspace.bound', () => {
    useHydration.getState().setPhase('binding')
  })

  // Workspace attached - this triggers the loading phase
  // The existing sessionUi.runOnce will do the actual hydration
  client.subscribe('workspace.attached', () => {
    const phase = useHydration.getState().phase
    console.log('[hydration] workspace.attached received, current phase:', phase)
    if (phase === 'binding' || phase === 'connected') {
      useHydration.getState().setPhase('loading')
    }
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

