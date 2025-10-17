/**
 * newContext node
 *
 * Creates a completely isolated execution context for parallel flows.
 * Useful for running separate conversations (e.g., bootstrap flows with cheap models)
 * that don't pollute the main conversation history.
 *
 * Inputs: None (entry node for isolated context)
 * Outputs:
 * - context: The new isolated execution context (teal color)
 * - data: None
 */

import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // Entry node, no inputs needed
  description: 'Creates an isolated execution context for parallel flows. Use for bootstrap flows or separate conversations that should not share message history with the main context.'
}

/**
 * Node implementation
 */
export const newContextNode: NodeFunction = async (_contextIn, dataIn, _inputs, config) => {
  const nodeId = (config as any)?._nodeId || 'newContext'
  const provider = (config.provider as string) || 'openai'
  const model = (config.model as string) || 'gpt-4o'
  const systemInstructions = (config.systemInstructions as string) || ''

  console.log('[newContext] Creating isolated context:', {
    nodeId,
    provider,
    model,
    systemInstructions: systemInstructions?.substring(0, 50)
  })

  // Create isolated context with stable ID based on nodeId
  // This ensures the same context is reused across flow executions
  const newContext: MainFlowContext = {
    contextId: `context-${nodeId}`,
    contextType: 'isolated', // Mark as isolated for teal color
    provider,
    model,
    systemInstructions,
    messageHistory: []
  }

  console.log('[newContext] Created context:', {
    contextId: newContext.contextId,
    contextType: newContext.contextType
  })

  return {
    context: newContext,
    data: dataIn, // Pass through any data
    status: 'success'
  }
}

