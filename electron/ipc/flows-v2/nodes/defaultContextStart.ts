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

import type { NodeFunction, NodeExecutionPolicy } from '../types'

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
export const defaultContextStartNode: NodeFunction = async (contextIn, _dataIn, _inputs, config) => {
  // This is an entry node that establishes the initial context
  // Read system instructions from node config and set them on the context

  const systemInstructions = (config as any)?.systemInstructions

  console.log('[defaultContextStart] Input context:', {
    provider: contextIn.provider,
    model: contextIn.model,
    systemInstructions: contextIn.systemInstructions?.substring(0, 50),
    messageHistoryLength: contextIn.messageHistory.length
  })
  console.log('[defaultContextStart] Config systemInstructions:', systemInstructions?.substring(0, 50))

  const outputContext = {
    ...contextIn,
    systemInstructions: systemInstructions || contextIn.systemInstructions
  }

  console.log('[defaultContextStart] Output context:', {
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

