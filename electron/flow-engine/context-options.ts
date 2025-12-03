import type { Message } from './contextManager'

/**
 * Shared context configuration types for FlowAPI and scheduler helpers.
 */

export interface CreateIsolatedContextOptions {
  provider?: string
  model?: string
  systemInstructions?: string
  /** When true, inherit system instructions from the base context if not overridden */
  inheritSystemInstructions?: boolean
  /** When true, clone the base context's message history into the new context */
  inheritHistory?: boolean
  /** Optional seed messages for the new context (applied after inherited history) */
  initialMessages?: Message[]
  /** Optional label for the new context */
  label?: string
  /** Explicit base context to derive from (defaults to the active context) */
  baseContextId?: string
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  includeThoughts?: boolean
  thinkingBudget?: number
  modelOverrides?: Array<{
    model: string
    temperature?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
    includeThoughts?: boolean
    thinkingBudget?: number
  }>
  /** @internal - FlowScheduler stamps the creating node for diagnostics */
  createdByNodeId?: string
}
