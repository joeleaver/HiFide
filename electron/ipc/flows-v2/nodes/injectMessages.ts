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
export const injectMessagesNode: NodeFunction = async (contextIn, _dataIn, inputs, config) => {
  const nodeId = (config as any)?._nodeId || 'inject-messages'

  // Get message content (dynamic inputs override static config)
  const userMessage = inputs.userMessage || config.staticUserMessage
  const assistantMessage = inputs.assistantMessage || config.staticAssistantMessage

  // Debug logging
  console.log('[injectMessages] Inputs:', {
    userMessage: typeof userMessage === 'string' ? userMessage.substring(0, 50) : userMessage,
    assistantMessage: typeof assistantMessage === 'string' ? assistantMessage.substring(0, 50) : assistantMessage,
    hasUserInput: !!inputs.userMessage,
    hasAssistantInput: !!inputs.assistantMessage,
    hasStaticUser: !!config.staticUserMessage,
    hasStaticAssistant: !!config.staticAssistantMessage
  })

  // Validation: both required and non-empty
  if (!userMessage?.trim() || !assistantMessage?.trim()) {
    const errorMsg = !userMessage?.trim()
      ? 'User message is required and must be non-empty'
      : 'Assistant message is required and must be non-empty'

    console.error('[injectMessages] Validation failed:', errorMsg)

    return {
      context: contextIn,
      status: 'error',
      error: errorMsg
    }
  }
  
  // Get injection mode (default to prepend for bootstrap use case)
  const injectionMode = config.injectionMode || 'prepend'
  
  // Create message pair with auto-generated IDs based on node ID
  const userMsg = {
    role: 'user' as const,
    content: userMessage.trim(),
    metadata: {
      id: `${nodeId}-user`,
      pinned: config.pinned || false,
      priority: config.priority || 50
    }
  }
  
  const assistantMsg = {
    role: 'assistant' as const,
    content: assistantMessage.trim(),
    metadata: {
      id: `${nodeId}-assistant`,
      pinned: config.pinned || false,
      priority: config.priority || 50
    }
  }
  
  // Clone message history
  const history = [...contextIn.messageHistory]
  
  // Check if messages already exist (for idempotency)
  const userIdx = history.findIndex(m => m.metadata?.id === userMsg.metadata.id)
  const assistantIdx = history.findIndex(m => m.metadata?.id === assistantMsg.metadata.id)
  
  if (userIdx >= 0 && assistantIdx >= 0) {
    // Update in place (idempotent behavior)
    history[userIdx] = userMsg
    history[assistantIdx] = assistantMsg
  } else {
    // Insert new messages based on mode
    if (injectionMode === 'prepend') {
      // Add to beginning (user first, then assistant)
      history.unshift(userMsg, assistantMsg)
    } else {
      // Add to end (user first, then assistant)
      history.push(userMsg, assistantMsg)
    }
  }
  
  return {
    context: { ...contextIn, messageHistory: history },
    data: { userMessage: userMsg.content, assistantMessage: assistantMsg.content },
    status: 'success'
  }
}

