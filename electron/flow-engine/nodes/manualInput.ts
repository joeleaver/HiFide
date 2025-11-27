/**
 * manualInput node
 *
 * Outputs a pre-configured message. If context is provided, adds the message to history.
 *
 * Inputs:
 * - context: Optional execution context from predecessor
 * - data: Not used
 *
 * Outputs:
 * - context: Updated context with message added to history (if context provided)
 * - data: The configured message
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // No inputs needed
  description: 'Outputs a pre-configured message. If context is provided, adds the message to history.'
}

/**
 * Node implementation
 */
export const manualInputNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected (optional)
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  const message = config.message || ''

  flow.log.debug('Manual input', { message })

  // If context provided, add message to history
  const newContext = executionContext && message
    ? flow.context.addMessage(executionContext, 'user', message)
    : executionContext

  return {
    context: newContext,
    data: message,
    status: 'success'
  }
}

