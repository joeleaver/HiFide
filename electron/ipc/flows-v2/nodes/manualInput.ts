/**
 * manualInput node
 *
 * Sends a pre-configured user message to the LLM in the current context.
 *
 * Inputs:
 * - context: Execution context from predecessor
 * - data: Not used
 *
 * Outputs:
 * - context: Updated context with message added to history
 * - data: The configured message
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // No inputs needed
  description: 'Sends a pre-configured user message to the LLM in the current context.'
}

/**
 * Node implementation
 */
export const manualInputNode: NodeFunction = async (contextIn, _dataIn, _inputs, config) => {
  const message = config.message || ''

  // Clone context to avoid mutating input
  const context = { ...contextIn, messageHistory: [...contextIn.messageHistory] }

  if (message) {
    // Add the message to the context's message history
    context.messageHistory.push({ role: 'user', content: message })
    context.currentOutput = message
  }

  return {
    context: context,
    data: message,
    status: 'success'
  }
}

