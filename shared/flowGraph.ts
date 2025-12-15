export type FlowGraphChangeReason =
  | 'workspace-snapshot'
  | 'template-load'
  | 'session-change'
  | 'flow-switch'
  | 'autosave'
  | 'unknown'

export interface FlowGraphChangedEventPayload {
  reason?: FlowGraphChangeReason
}

const HYDRATION_REASONS: ReadonlySet<FlowGraphChangeReason> = new Set([
  'workspace-snapshot',
  'template-load',
  'session-change',
  'flow-switch',
])

export const shouldHydrateFlowGraphChange = (reason?: string | null): reason is FlowGraphChangeReason => {
  if (!reason) return false
  return HYDRATION_REASONS.has(reason as FlowGraphChangeReason)
}
