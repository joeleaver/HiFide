import { useFlowEditorHydration } from '@/store/screenHydration'
import { useFlowEditorLocal } from '@/store/flowEditorLocal'

let controllerInitialized = false

function ensureFlowEditorReadyFromGraphHydration(): void {
  const hydration = useFlowEditorHydration.getState()
  const graph = useFlowEditorLocal.getState()

  if (!graph.isHydrated) return

  // Our hydration store only allows loading/refreshing -> ready.
  // When graph hydration completes while the screen is still idle,
  // transition through loading to satisfy the state machine.
  if (hydration.phase === 'idle') hydration.startLoading()
  hydration.setReady()
}

export function reloadFlowEditorScreen(): void {
  const hydration = useFlowEditorHydration.getState()
  hydration.startLoading()
  // Graph hydration is driven by workspace snapshot + backend events.
  // If it is already hydrated, this will immediately settle to ready.
  ensureFlowEditorReadyFromGraphHydration()
}

export function initFlowEditorScreenController(): void {
  if (controllerInitialized) return
  controllerInitialized = true

  // Attempt once on boot.
  ensureFlowEditorReadyFromGraphHydration()

  // Drive readiness from the graph store (single source of truth).
  let lastHydrated = useFlowEditorLocal.getState().isHydrated
  useFlowEditorLocal.subscribe((state) => {
    if (state.isHydrated && !lastHydrated) {
      ensureFlowEditorReadyFromGraphHydration()
    }
    lastHydrated = state.isHydrated
  })
}

