/**
 * userInput node - Simple version
 *
 * Waits for user input by awaiting a promise that resolves when the user submits.
 * No pause/resume state machine needed - just natural async/await!
 *
 * Inputs:
 * - context: Execution context from predecessor (REQUIRED)
 *
 * Outputs:
 * - context: Pass-through context
 * - data: User's message
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // Execute on ANY input (supports loops)
  description: 'Waits for user input by awaiting a promise that resolves when the user submits.'
}

/**
 * Node implementation
 */
export const userInputNode: NodeFunction = async (flow, context, _dataIn, inputs, _config) => {
  // Get context - use pushed context, or pull if edge connected
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    flow.log.error('Context is required')
    return {
      context: executionContext!,
      status: 'error',
      error: 'userInput node requires a context input'
    }
  }

  flow.log.info('Waiting for user input...')

  // Wait for user input via FlowAPI
  // This creates a promise that will be resolved when the user submits
  const userInput = await flow.waitForUserInput()

  flow.log.debug('Received user input', { length: userInput.length })

  return {
    context: executionContext, // Pass through the context
    data: userInput, // User's message
    status: 'success'
  }
}

