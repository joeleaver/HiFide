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
import { useMainStore } from '../../../store/index.js'

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
export const userInputNode: NodeFunction = async (contextIn, _dataIn, _inputs, _config) => {
  // Get the node ID from config (passed by scheduler)
  const nodeId = (_config as any)._nodeId || 'user-input'

  // Call store action to wait for user input
  // This creates a promise that will be resolved when the user submits
  const userInput = await useMainStore.getState().feWaitForUserInput(nodeId)

  return {
    context: contextIn, // Pass through the context
    data: userInput,    // User's message
    status: 'success'
  }
}

