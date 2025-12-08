/**
 * Screen Hydration Store Factory
 * 
 * Creates per-screen hydration stores that track loading state for individual features.
 * Each screen gets its own state machine: idle → loading → ready (or error)
 * 
 * Benefits:
 * - Lazy loading: screens only load data when becoming visible
 * - Error isolation: one screen failing doesn't block others
 * - Optimistic updates: refreshing shows stale content while fetching new data
 * - Independent retry: each screen handles its own retry logic
 */

import { create, StoreApi, UseBoundStore } from 'zustand'
import type { ScreenPhase, ScreenId } from '../../shared/hydration'
import { SCREEN_TIMEOUTS, isValidScreenTransition } from '../../shared/hydration'

export interface ScreenHydrationStore {
  // State
  phase: ScreenPhase
  error: string | null
  since: number
  lastReady: number | null
  
  // Computed
  isLoading: boolean
  hasData: boolean
  
  // Actions
  startLoading: () => void
  setReady: () => void
  setRefreshing: () => void
  setError: (error: string) => void
  reset: () => void
  
  // Internal
  _setPhase: (phase: ScreenPhase, error?: string) => void
}

/**
 * Creates a screen-specific hydration store
 */
export function createScreenHydrationStore(
  screenId: ScreenId,
  options?: {
    /** Callback when screen becomes ready */
    onReady?: () => void
    /** Callback when screen errors */
    onError?: (error: string) => void
    /** Custom timeout (default: 30s) */
    timeout?: number
  }
): UseBoundStore<StoreApi<ScreenHydrationStore>> {
  const timeout = options?.timeout ?? SCREEN_TIMEOUTS.maxLoading
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const clearTimeoutTimer = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return create<ScreenHydrationStore>((set, get) => ({
    phase: 'idle',
    error: null,
    since: 0,
    lastReady: null,
    
    // Computed getters
    get isLoading() { return get().phase === 'loading' },
    get hasData() { 
      const p = get().phase
      return p === 'ready' || p === 'refreshing' 
    },

    _setPhase: (phase: ScreenPhase, error?: string) => {
      const current = get().phase
      if (!isValidScreenTransition(current, phase)) {
        console.warn(`[${screenId}] Invalid transition: ${current} → ${phase}`)
        return
      }

      clearTimeoutTimer()
      const now = Date.now()

      set({
        phase,
        error: error ?? null,
        since: now,
        lastReady: phase === 'ready' ? now : get().lastReady,
      })

      // Start timeout for loading phase
      if (phase === 'loading') {
        timeoutId = setTimeout(() => {
          if (get().phase === 'loading') {
            console.warn(`[${screenId}] Loading timeout after ${timeout}ms`)
            get().setError('Loading timed out')
          }
        }, timeout)
      }

      // Callbacks
      if (phase === 'ready') options?.onReady?.()
      if (phase === 'error' && error) options?.onError?.(error)
    },

    startLoading: () => {
      const current = get().phase
      // From idle or error, go to loading
      // From ready, also go to loading (full reload)
      if (current === 'idle' || current === 'error' || current === 'ready') {
        get()._setPhase('loading')
      }
    },

    setReady: () => {
      const current = get().phase
      if (current === 'loading' || current === 'refreshing') {
        get()._setPhase('ready')
      }
    },

    setRefreshing: () => {
      if (get().phase === 'ready') {
        get()._setPhase('refreshing')
      }
    },

    setError: (error: string) => {
      const current = get().phase
      if (current === 'loading' || current === 'refreshing') {
        get()._setPhase('error', error)
      }
    },

    reset: () => {
      clearTimeoutTimer()
      set({
        phase: 'idle',
        error: null,
        since: 0,
        lastReady: null,
      })
    },
  }))
}

// Pre-created stores for each screen
export const useFlowEditorHydration = createScreenHydrationStore('flowEditor')
export const useExplorerHydration = createScreenHydrationStore('explorer')
export const useKanbanHydration = createScreenHydrationStore('kanban')
export const useKnowledgeBaseHydration = createScreenHydrationStore('knowledgeBase')
export const useSettingsHydration = createScreenHydrationStore('settings')
export const useTerminalHydration = createScreenHydrationStore('terminal')
export const useMcpHydration = createScreenHydrationStore('mcp')

