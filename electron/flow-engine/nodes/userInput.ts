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
export const userInputNode: NodeFunction = async (flow, _context, _dataIn, _inputs, _config) => {
  flow.log.info('Waiting for user input...')

  // Wait for user input via FlowAPI
  // This creates a promise that will be resolved when the user submits
  const userInput = await flow.waitForUserInput()
  
  if (typeof userInput === 'string') {
    const trimmed = userInput.trim()
    if (trimmed.length > 0) {
      flow.context.addMessage({ role: 'user', content: trimmed })
      flow.log.debug('Appended user input to context history', { length: trimmed.length })
    } else {
      flow.log.warn('Received empty user input; skipping context mutation')
    }
  } else if (Array.isArray(userInput)) {
    // Multi-modal input
    flow.context.addMessage({ role: 'user', content: userInput as any })
    flow.log.debug('Appended multi-modal user input to context history', { parts: userInput.length })
  }

  return {
    context: flow.context.get(),
    data: userInput,
    status: 'success'
  }
}
