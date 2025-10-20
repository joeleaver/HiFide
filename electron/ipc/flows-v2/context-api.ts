/**
 * Context API - Centralized, immutable context management for flow nodes
 * 
 * Provides a clean API for nodes to manage execution contexts without
 * directly manipulating context objects. All operations are immutable -
 * they return new context objects rather than mutating in place.
 */

import type { MainFlowContext } from './types'
import crypto from 'crypto'

export interface ContextAPI {
  /**
   * Create a new execution context
   */
  create: (params: {
    provider: string
    model: string
    systemInstructions?: string
  }) => MainFlowContext

  /**
   * Update context fields (immutable - returns new context)
   */
  update: (
    context: MainFlowContext,
    updates: Partial<MainFlowContext>
  ) => MainFlowContext

  /**
   * Add a single message to context (immutable - returns new context)
   */
  addMessage: (
    context: MainFlowContext,
    role: 'user' | 'assistant',
    content: string,
    options?: {
      id?: string           // For idempotency
      pinned?: boolean      // Pin to top during windowing
      priority?: number     // Priority for pinned messages (default: 50)
    }
  ) => MainFlowContext

  /**
   * Add multiple messages to context (immutable - returns new context)
   */
  addMessages: (
    context: MainFlowContext,
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      id?: string
      pinned?: boolean
      priority?: number
    }>
  ) => MainFlowContext

  /**
   * Inject a user/assistant message pair into context
   * Used by injectMessages node for bootstrap scenarios
   * (immutable - returns new context)
   */
  injectPair: (
    context: MainFlowContext,
    userMessage: string,
    assistantMessage: string,
    options?: {
      mode?: 'prepend' | 'append'  // Default: 'prepend'
      pinned?: boolean              // Default: false
      priority?: number             // Default: 50
      idPrefix?: string             // For generating message IDs
    }
  ) => MainFlowContext

  /**
   * Remove messages by ID (immutable - returns new context)
   */
  removeMessages: (
    context: MainFlowContext,
    messageIds: string[]
  ) => MainFlowContext

  /**
   * Update a message by ID (immutable - returns new context)
   */
  updateMessage: (
    context: MainFlowContext,
    messageId: string,
    updates: {
      content?: string
      pinned?: boolean
      priority?: number
    }
  ) => MainFlowContext
}

/**
 * Create a ContextAPI instance
 */
export function createContextAPI(): ContextAPI {
  return {
    create: ({ provider, model, systemInstructions }) => {
      return {
        contextId: crypto.randomUUID(),
        provider,
        model,
        systemInstructions: systemInstructions || '',
        messageHistory: []
      }
    },

    update: (context, updates) => {
      return {
        ...context,
        ...updates
      }
    },

    addMessage: (context, role, content, options = {}) => {
      const { id = crypto.randomUUID(), pinned = false, priority = 50 } = options

      const message = {
        role,
        content,
        ...(pinned ? {
          metadata: {
            id,
            pinned,
            priority
          }
        } : {})
      }

      return {
        ...context,
        messageHistory: [...context.messageHistory, message]
      }
    },

    addMessages: (context, messages) => {
      const newMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.pinned ? {
          metadata: {
            id: msg.id ?? crypto.randomUUID(),
            pinned: msg.pinned,
            priority: msg.priority ?? 50
          }
        } : {})
      }))

      return {
        ...context,
        messageHistory: [...context.messageHistory, ...newMessages]
      }
    },

    injectPair: (context, userMessage, assistantMessage, options = {}) => {
      const {
        mode = 'prepend',
        pinned = false,
        priority = 50,
        idPrefix = crypto.randomUUID()
      } = options

      // Create message pair with IDs
      const userMsg = {
        role: 'user' as const,
        content: userMessage,
        metadata: {
          id: `${idPrefix}-user`,
          pinned,
          priority
        }
      }

      const assistantMsg = {
        role: 'assistant' as const,
        content: assistantMessage,
        metadata: {
          id: `${idPrefix}-assistant`,
          pinned,
          priority
        }
      }

      // Clone message history
      const history = [...context.messageHistory]

      // Check if messages already exist (idempotency)
      const userIdx = history.findIndex(m => m.metadata?.id === userMsg.metadata.id)
      const assistantIdx = history.findIndex(m => m.metadata?.id === assistantMsg.metadata.id)

      if (userIdx >= 0 && assistantIdx >= 0) {
        // Update in place (idempotent behavior)
        history[userIdx] = userMsg
        history[assistantIdx] = assistantMsg
      } else {
        // Insert new messages based on mode
        if (mode === 'prepend') {
          // Add to beginning (user first, then assistant)
          history.unshift(userMsg, assistantMsg)
        } else {
          // Add to end (user first, then assistant)
          history.push(userMsg, assistantMsg)
        }
      }

      return {
        ...context,
        messageHistory: history
      }
    },

    removeMessages: (context, messageIds) => {
      const idsToRemove = new Set(messageIds)

      return {
        ...context,
        messageHistory: context.messageHistory.filter(
          msg => !msg.metadata?.id || !idsToRemove.has(msg.metadata.id)
        )
      }
    },

    updateMessage: (context, messageId, updates) => {
      return {
        ...context,
        messageHistory: context.messageHistory.map(msg => {
          if (msg.metadata?.id !== messageId) {
            return msg
          }

          return {
            ...msg,
            ...(updates.content !== undefined ? { content: updates.content } : {}),
            metadata: {
              ...msg.metadata,
              ...(updates.pinned !== undefined ? { pinned: updates.pinned } : {}),
              ...(updates.priority !== undefined ? { priority: updates.priority } : {})
            }
          }
        })
      }
    }
  }
}

