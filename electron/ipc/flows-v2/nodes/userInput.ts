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
export const userInputNode: NodeFunction = async (contextIn, _dataIn, _inputs, _config) => {
  // We need access to the scheduler to wait for user input
  // The scheduler reference is passed via context._scheduler (a bit hacky but works)
  const scheduler = (contextIn as any)._scheduler

  if (!scheduler) {
    throw new Error('userInput node requires scheduler reference in context')
  }

  // Get the node ID from config (passed by scheduler)
  const nodeId = (_config as any)._nodeId || 'user-input'

  // Await user input - this naturally pauses execution until user submits
  const userInput = await scheduler.waitForUserInput(nodeId)

  return {
    context: contextIn, // Pass through the context
    data: userInput,    // User's message
    status: 'success'
  }
}

