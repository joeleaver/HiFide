/**
 * injectMessages node
 *
 * Injects a user/assistant message pair into the conversation history.
 * Supports both static configuration and dynamic inputs.
 * All injections are idempotent - re-running updates messages in place.
 *
 * Inputs:
 * - context: Execution context from predecessor (REQUIRED)
 * - userMessage: Dynamic user message content (OPTIONAL - overrides static config)
 * - assistantMessage: Dynamic assistant message content (OPTIONAL - overrides static config)
 *
 * Outputs:
 * - context: Updated context with injected messages
 * - data: The injected message pair (for debugging)
 *
 * Config:
 * - staticUserMessage: Static user message (used if no dynamic input)
 * - staticAssistantMessage: Static assistant message (used if no dynamic input)
 * - injectionMode: 'append' | 'prepend' (default: 'prepend')
 * - pinned: Whether to pin messages to top during context windowing (default: false)
 * - priority: Priority for pinned messages (default: 50, only used if pinned=true)
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Injects a user/assistant message pair into conversation history. Idempotent - re-running updates in place.'
}

/**
 * Node implementation
 */
export const injectMessagesNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    flow.log.error('Context is required')
    return {
      context: executionContext!,
      status: 'error',
      error: 'injectMessages node requires a context input'
    }
  }

  // Get message content (dynamic inputs override static config)
  const userMessage = inputs.has('userMessage')
    ? await inputs.pull('userMessage')
    : config.staticUserMessage

  const assistantMessage = inputs.has('assistantMessage')
    ? await inputs.pull('assistantMessage')
    : config.staticAssistantMessage

  // Debug logging
  flow.log.debug('Inputs', {
    userMessage: typeof userMessage === 'string' ? userMessage.substring(0, 50) : userMessage,
    assistantMessage: typeof assistantMessage === 'string' ? assistantMessage.substring(0, 50) : assistantMessage,
    hasUserInput: inputs.has('userMessage'),
    hasAssistantInput: inputs.has('assistantMessage'),
    hasStaticUser: !!config.staticUserMessage,
    hasStaticAssistant: !!config.staticAssistantMessage
  })

  // Validation: both required and non-empty
  if (!userMessage?.trim() || !assistantMessage?.trim()) {
    const errorMsg = !userMessage?.trim()
      ? 'User message is required and must be non-empty'
      : 'Assistant message is required and must be non-empty'

    flow.log.error('Validation failed', { errorMsg })

    return {
      context: executionContext,
      status: 'error',
      error: errorMsg
    }
  }

  // Use ContextAPI to inject the pair (immutable, idempotent)
  const newContext = flow.context.injectPair(
    executionContext,
    userMessage.trim(),
    assistantMessage.trim(),
    {
      mode: (config.injectionMode as 'prepend' | 'append') || 'prepend',
      pinned: config.pinned || false,
      priority: config.priority || 50,
      idPrefix: flow.nodeId // For idempotency
    }
  )

  flow.log.debug('Injected message pair', {
    mode: config.injectionMode || 'prepend',
    pinned: config.pinned || false
  })

  return {
    context: newContext,
    data: { userMessage: userMessage.trim(), assistantMessage: assistantMessage.trim() },
    status: 'success'
  }
}

