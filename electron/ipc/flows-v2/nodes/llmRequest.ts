/**
 * llmRequest node
 *
 * Sends a message to the LLM and returns the response.
 * Supports tools via agentStream if provided.
 *
 * Inputs:
 * - context: Execution context from predecessor (OPTIONAL - can use config provider/model instead)
 * - data: User message to send to LLM (REQUIRED)
 * - tools: Optional array of tool definitions
 *
 * Config:
 * - provider: Provider to use when no context is connected (default: 'openai')
 * - model: Model to use when no context is connected (default: first available model)
 * - overrideEnabled: Whether to override the context provider/model (default: false)
 * - overrideProvider: Provider to use when override is enabled
 * - overrideModel: Model to use when override is enabled
 *
 * Outputs:
 * - context: Updated context with message history
 * - data: Assistant's response
 */

import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'
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

  console.log(`[llmRequest] ${nodeId} - Starting execution:`, {
    hasMessage: !!message,
    messageLength: message?.length,
    hasTools: !!inputs.tools,
    contextProvider: contextIn?.provider,
    contextModel: contextIn?.model
  })

  if (!message) {
    console.error(`[llmRequest] ${nodeId} - ERROR: No message provided`)
    return {
      context: contextIn,
      status: 'error',
      error: 'No message provided to LLM Request node'
    }
  }

  // Determine context to use
  let context: MainFlowContext

  if (contextIn && contextIn.provider && contextIn.model) {
    // Use provided context if it has provider/model
    context = contextIn

    // If override is enabled, update the provider/model in the context
    if ((config.overrideEnabled as boolean) && config.overrideProvider && config.overrideModel) {
      context = {
        ...context,
        provider: config.overrideProvider as string,
        model: config.overrideModel as string
      }
      console.log(`[llmRequest] ${nodeId} - Override enabled, using provider/model:`, {
        provider: context.provider,
        model: context.model
      })
    }
  } else {
    // No context provided or incomplete - create new context from config
    const provider = (config.provider as string) || 'openai'
    const model = (config.model as string) || 'gpt-4o'

    context = {
      contextId: `llm-${nodeId}-${Date.now()}`,
      provider,
      model,
      systemInstructions: '',
      messageHistory: []
    }
  }

  // Call LLM service - it handles everything!
  console.log(`[llmRequest] ${nodeId} - Calling LLM service:`, {
    provider: context.provider,
    model: context.model,
    messageLength: message.length,
    hasTools: !!inputs.tools,
    toolCount: inputs.tools?.length || 0
  })

  const result = await llmService.chat({
    message,
    tools: inputs.tools,
    context,
    nodeId
  })

  console.log(`[llmRequest] ${nodeId} - LLM service response:`, {
    hasError: !!result.error,
    error: result.error,
    textLength: result.text?.length || 0,
    messageHistoryLength: result.updatedContext.messageHistory.length
  })

  if (result.error) {
    console.error(`[llmRequest] ${nodeId} - ERROR from LLM service:`, result.error)
    return {
      context: result.updatedContext,
      status: 'error',
      error: result.error
    }
  }

  console.log(`[llmRequest] ${nodeId} - SUCCESS:`, {
    responseLength: result.text.length,
    responsePreview: result.text.substring(0, 100) + '...'
  })

  return {
    context: result.updatedContext,
    data: result.text,
    status: 'success'
  }
}

