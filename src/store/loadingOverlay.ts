import { create } from 'zustand'
import { useBackendBinding } from './binding'
import { useSessionUi } from './sessionUi'
import { useChatTimeline } from './chatTimeline'

// Renderer-only store to drive the loading overlay without React effects in components.
// Purely derived from other UI stores — no timers/guards.

export type OverlayPhase = 'idle' | 'waitingSessions' | 'waitingSelection' | 'hydratingTimeline'

interface LoadingOverlayState {
  active: boolean
  message: string | null
  phase: OverlayPhase
  overlaySince: number | null
  hydratingSince: number | null
  // Debug
  overlayAgeMs: number
  hydratingAgeMs: number
}

interface LoadingOverlayStore extends LoadingOverlayState {
  // Recompute based on current external stores
  _recompute: () => void
}

export const useLoadingOverlay = create<LoadingOverlayStore>((set, get) => {
  const recompute = () => {
    const attached = useBackendBinding.getState().attached
    const sessionsCount = (useSessionUi.getState().sessions?.length || 0)
    const currentId = useSessionUi.getState().currentId
    const hasList = useSessionUi.getState().hasHydratedList

    const timelineState: any = useChatTimeline.getState()
    // Treat the timeline as hydrating until it has rendered once for any
    // workspace that actually has sessions. For an empty workspace
    // (sessionsCount === 0), we don't gate on hasRenderedOnce.
    const hydratingTimeline = !!(
      timelineState.isHydrating ||
      (sessionsCount > 0 && !timelineState.hasRenderedOnce)
    )
    const hydratingMeta = useSessionUi.getState().isHydratingMeta
    const hydratingUsage = useSessionUi.getState().isHydratingUsage

    if (!attached) {
      set({ active: false, message: null, phase: 'idle', overlaySince: null, hydratingSince: null, overlayAgeMs: 0, hydratingAgeMs: 0 })
      return
    }

    let phase: OverlayPhase = 'idle'
    if (!hasList) phase = 'waitingSessions'
    else if (hydratingTimeline || hydratingMeta || hydratingUsage) phase = 'hydratingTimeline'
    else if (sessionsCount > 0 && !currentId) phase = 'waitingSelection'

    const active = phase !== 'idle'
    const now = Date.now()

    set((prev) => ({
      active,
      message: phase === 'hydratingTimeline' ? 'Restoring session…' : active ? 'Opening workspace…' : null,
      phase,
      overlaySince: active && !prev.overlaySince ? now : active ? prev.overlaySince : null,
      hydratingSince: (hydratingTimeline || hydratingMeta || hydratingUsage)
        ? (!prev.hydratingSince ? now : prev.hydratingSince)
        : null,
      overlayAgeMs: prev.overlaySince ? (now - prev.overlaySince) : 0,
      hydratingAgeMs: prev.hydratingSince ? (now - prev.hydratingSince) : 0,
    }))
  }

  // Subscribe to dependencies and recompute on change
  const unsubscribers: Array<() => void> = []
  try {
    unsubscribers.push(useBackendBinding.subscribe((s: any) => s.attached, () => get()._recompute()))
    unsubscribers.push(useSessionUi.subscribe((s: any) => [s.sessions, s.currentId, s.isHydratingMeta, s.isHydratingUsage, s.hasHydratedList], () => get()._recompute()))
    unsubscribers.push(useChatTimeline.subscribe((s: any) => [s.isHydrating, (s as any).hasRenderedOnce], () => get()._recompute()))
  } catch {}

  // Initial compute (sync + microtask)
  try { get()._recompute() } catch {}
  setTimeout(() => { try { get()._recompute() } catch {} }, 0)

  return {
    active: false,
    message: null,
    phase: 'idle',
    overlaySince: null,
    hydratingSince: null,
    overlayAgeMs: 0,
    hydratingAgeMs: 0,

    _recompute: recompute,
  }
})

