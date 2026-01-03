/**
 * defaultContextStart node
 *
 * Entry point for the main conversation flow.
 * Uses global provider/model settings and optional system instructions.
 *
 * Inputs: None (entry node)
 * Outputs:
 * - context: The initialized execution context
 * - data: None
 */

import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'
import { normalizeContentToText } from '../llm/payloads'

// Sanitize message history to ensure exact user/assistant pairs at the tail.
// - Drops trailing unmatched user message
// - Drops trailing assistant messages with blank content
// - Drops trailing assistant messages that are not preceded by a user
// This only trims recent invalid entries; earlier history is preserved.
function sanitizeMessageHistory(
  history: MainFlowContext['messageHistory']
): { history: MainFlowContext['messageHistory']; removed: number } {
  const sanitized = [...history]
  let removed = 0

  const isBlank = (s: string | any[] | undefined | null) => {
    const text = typeof s === 'string' ? s : normalizeContentToText(s as any)
    return !text || text.trim().length === 0
  }
  const isNonSystem = (m: MainFlowContext['messageHistory'][number]) => m.role === 'user' || m.role === 'assistant'

  // Helper to find last non-system index
  const lastNonSystemIndex = () => {
    for (let i = sanitized.length - 1; i >= 0; i--) {
      if (isNonSystem(sanitized[i])) return i
    }
    return -1
  }

  // Repeatedly trim invalid tail conditions until tail ends with a valid pair
  // Valid tail: ... user, assistant(with non-blank content) [possibly followed by system msgs]
  while (true) {
    const lastIdx = lastNonSystemIndex()
    if (lastIdx === -1) break // no user/assistant messages

    const last = sanitized[lastIdx]

    if (last.role === 'assistant') {
      // If assistant is blank, drop it
      if (isBlank(last.content)) {
        sanitized.splice(lastIdx, 1)
        removed++
        continue
      }

      // Ensure previous non-system is a user
      let prevIdx = -1
      for (let i = lastIdx - 1; i >= 0; i--) {
        if (isNonSystem(sanitized[i])) { prevIdx = i; break }
      }

      if (prevIdx === -1) {
        // Assistant without preceding user
        sanitized.splice(lastIdx, 1)
        removed++
        continue
      }

      const prev = sanitized[prevIdx]
      if (prev.role !== 'user') {
        // Misordered tail; drop the last assistant only
        sanitized.splice(lastIdx, 1)
        removed++
        continue
      }

      // Tail is valid (user followed by non-blank assistant)
      break
    } else if (last.role === 'user') {
      // Unmatched user at tail — drop it
      sanitized.splice(lastIdx, 1)
      removed++
      continue
    } else {
      // Should not happen (only user/assistant reach here)
      break
    }
  }

  return { history: sanitized, removed }
}

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // Entry node, no inputs needed
  description: 'Entry point for the main conversation flow. Uses global provider/model settings and optional system instructions.'
}

/**
 * Node implementation
 */
export const defaultContextStartNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  const manager = flow.context
  const snapshot = context ?? manager.get()

  const systemInstructionsFromConfig = (config as any)?.systemInstructions
  const temperature = (config as any)?.temperature as number | undefined
  const reasoningEffort = (config as any)?.reasoningEffort as ('low'|'medium'|'high') | undefined
  const includeThoughts = !!(config as any)?.includeThoughts
  const thinkingBudget = (config as any)?.thinkingBudget as number | undefined
  const modelOverrides = (config as any)?.modelOverrides as Array<{
    model: string
    temperature?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
    includeThoughts?: boolean
    thinkingBudget?: number
  }> | undefined

  let systemInstructions = systemInstructionsFromConfig
  if (inputs.has('systemInstructionsIn')) {
    try {
      const v = await inputs.pull('systemInstructionsIn')
      if (typeof v === 'string') systemInstructions = v
    } catch {}
  }

  const provider = snapshot?.provider || flow.store?.selectedProvider || 'openai'
  const model = snapshot?.model || flow.store?.selectedModel || 'gpt-4o'
  manager.setProviderModel(provider, model)

  const updates: Partial<MainFlowContext> = {}
  if (systemInstructions) updates.systemInstructions = systemInstructions
  if (typeof temperature === 'number') (updates as any).temperature = temperature
  if (reasoningEffort) (updates as any).reasoningEffort = reasoningEffort
  if (includeThoughts === true) (updates as any).includeThoughts = true
  if (typeof thinkingBudget === 'number') (updates as any).thinkingBudget = thinkingBudget
  if (modelOverrides?.length) (updates as any).modelOverrides = modelOverrides
  if (Object.keys(updates).length) {
    manager.update(updates)
  }

  const withUpdates = manager.get()
  const { history: cleanedHistory, removed } = sanitizeMessageHistory(withUpdates.messageHistory)
  if (removed > 0) {
    manager.replaceHistory(cleanedHistory)
    flow.log.warn('Sanitized messageHistory in defaultContextStart', {
      removed,
      before: withUpdates.messageHistory.length,
      after: cleanedHistory.length
    })
  }

  manager.update({ contextType: 'main' })
  const output = manager.get()

  flow.log.debug('defaultContextStart: output context', {
    provider: output.provider,
    model: output.model,
    systemInstructions: output.systemInstructions?.substring(0, 50),
    messageHistoryLength: output.messageHistory.length
  })

  return {
    context: output,
    status: 'success'
  }
}

