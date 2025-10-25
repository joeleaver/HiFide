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

  const isBlank = (s: string | undefined | null) => !s || s.trim().length === 0
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
  // This is an entry node that creates the main context
  // It uses the global provider/model from the store

  // Get context - use pushed context from scheduler (which includes session message history),
  // or pull if edge connected, or create new from store
  let executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    // No context provided - create from store's current provider/model
    // This should rarely happen since scheduler now passes mainContext
    const provider = flow.store.selectedProvider || 'openai'
    const model = flow.store.selectedModel || 'gpt-4o'

    executionContext = flow.context.create({
      provider,
      model,
      systemInstructions: ''
    })

    flow.log.debug('Created new main context', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  } else {
    flow.log.debug('Using context from scheduler', {
      provider: executionContext.provider,
      model: executionContext.model,
      messageHistoryLength: executionContext.messageHistory.length
    })
  }

  const systemInstructions = (config as any)?.systemInstructions

  // Always override provider/model with global selection
  const provider = flow.store?.selectedProvider || 'openai'
  const model = flow.store?.selectedModel || 'gpt-4o'
  const withProviderModel = flow.context.update(executionContext, { provider, model })

  flow.log.debug('Input context', {
    provider: withProviderModel.provider,
    model: withProviderModel.model,
    systemInstructions: withProviderModel.systemInstructions?.substring(0, 50),
    messageHistoryLength: withProviderModel.messageHistory.length
  })

  // Use ContextAPI to update system instructions (immutable)
  const baseContext = systemInstructions
    ? flow.context.update(withProviderModel, { systemInstructions })
    : withProviderModel

  // Sanity-check message history for exact user/assistant pairs at the tail
  const { history: cleanedHistory, removed } = sanitizeMessageHistory(baseContext.messageHistory)
  const sanitizedContext = removed > 0
    ? flow.context.update(baseContext, { messageHistory: cleanedHistory })
    : baseContext
  if (removed > 0) {
    flow.log.warn('Sanitized messageHistory in defaultContextStart', {
      removed,
      before: baseContext.messageHistory.length,
      after: cleanedHistory.length
    })
  }

  // Ensure main context is explicitly labeled
  const outputContext = flow.context.update(sanitizedContext, { contextType: 'main' as const } as any)

  flow.log.debug('Output context', {
    provider: outputContext.provider,
    model: outputContext.model,
    systemInstructions: outputContext.systemInstructions?.substring(0, 50),
    messageHistoryLength: outputContext.messageHistory.length
  })

  return {
    context: outputContext,
    status: 'success'
  }
}

