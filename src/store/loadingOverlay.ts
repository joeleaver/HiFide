import { create } from 'zustand'
import { useHydration } from './hydration'
import type { HydrationPhase } from '../../shared/hydration'

/**
 * Loading Overlay Store
 *
 * Now powered by the unified hydration state machine.
 * This store simply derives its state from useHydration.
 */

interface LoadingOverlayState {
  // Whether the overlay is active (derived from hydration phase)
  active: boolean
  // Human-readable message (derived from hydration phase)
  message: string | null
  // Current hydration phase
  phase: HydrationPhase
  // When the overlay became active
  overlaySince: number | null
}

interface LoadingOverlayStore extends LoadingOverlayState {
  // Recompute based on hydration state
  _recompute: () => void
}

export const useLoadingOverlay = create<LoadingOverlayStore>((set, get) => {
  const recompute = () => {
    const hydration = useHydration.getState()
    const now = Date.now()

    const newActive = hydration.isLoading
    const prevActive = get().active

    if (newActive !== prevActive) {
      console.log(`[loadingOverlay] active: ${prevActive} → ${newActive}, phase: ${hydration.phase}`)
    }

    set((prev) => ({
      active: newActive,
      message: hydration.loadingMessage,
      phase: hydration.phase,
      overlaySince: newActive && !prev.overlaySince
        ? now
        : newActive
          ? prev.overlaySince
          : null,
    }))
  }

  // Subscribe to hydration state changes
  try {
    useHydration.subscribe(() => {
      get()._recompute()
    })
  } catch {}

  // Initial compute
  try { get()._recompute() } catch {}
  setTimeout(() => { try { get()._recompute() } catch {} }, 0)

  return {
    active: false,
    message: null,
    phase: 'disconnected',
    overlaySince: null,
    _recompute: recompute,
  }
})
