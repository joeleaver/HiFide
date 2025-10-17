/**
 * llmRequest node
 *
 * Sends a message to the LLM and returns the response.
 * Supports tools via agentStream if provided.
 *
 * Inputs:
 * - context: Execution context from predecessor (REQUIRED)
 * - data: User message to send to LLM (REQUIRED)
 * - tools: Optional array of tool definitions
 *
 * Outputs:
 * - context: Updated context with message history
 * - data: Assistant's response
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'
import { llmService } from '../llm-service'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Sends a message to the LLM and returns the response. Supports tools via agentStream if provided.'
}

/**
 * Node implementation
 */
export const llmRequestNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const nodeId = (config as any)?._nodeId || 'llmRequest'
  const message = dataIn || ''

  if (!message) {
    return {
      context: contextIn,
      status: 'error',
      error: 'No message provided to LLM Request node'
    }
  }

  // Call LLM service - it handles everything!
  const result = await llmService.chat({
    message,
    tools: inputs.tools,
    context: contextIn,
    nodeId
  })

  if (result.error) {
    return {
      context: result.updatedContext,
      status: 'error',
      error: result.error
    }
  }

  return {
    context: result.updatedContext,
    data: result.text,
    status: 'success'
  }
}

