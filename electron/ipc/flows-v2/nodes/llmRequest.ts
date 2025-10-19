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
export const llmRequestNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Get message - use dataIn if provided (push), otherwise pull from input
  const message = dataIn ?? (inputs.has('data') ? await inputs.pull('data') : '')

  // Get context - use pushed context, or pull if edge connected, or create from config
  let executionContext: MainFlowContext

  if (context) {
    // Context was pushed - use it
    executionContext = context
  } else if (inputs.has('context')) {
    // Context edge connected but not pushed - pull it
    executionContext = await inputs.pull('context')
  } else {
    // No context edge - create from config
    const provider = (config.provider as string) || 'openai'
    const model = (config.model as string) || 'gpt-4o'
    executionContext = flow.context.create({
      provider,
      model,
      systemInstructions: ''
    })
    flow.log.debug('No context provided, created from config', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  }

  flow.log.debug('Starting execution', {
    hasMessage: !!message,
    messageLength: message?.length,
    hasDataIn: dataIn !== undefined,
    hasDataInput: inputs.has('data'),
    hasTools: inputs.has('tools'),
    contextProvider: executionContext?.provider,
    contextModel: executionContext?.model
  })

  if (!message) {
    flow.log.error('No message provided')
    return {
      context: executionContext,
      status: 'error',
      error: 'No message provided to LLM Request node'
    }
  }

  // Apply override if enabled
  if ((config.overrideEnabled as boolean) && config.overrideProvider && config.overrideModel) {
    executionContext = flow.context.update(executionContext, {
      provider: config.overrideProvider as string,
      model: config.overrideModel as string
    })
    flow.log.debug('Override enabled', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  } else {
    flow.log.debug('Using context provider/model', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  }

  // Pull tools if connected (lazy evaluation)
  const tools = inputs.has('tools') ? await inputs.pull('tools') : undefined

  flow.log.debug('Calling LLM service', {
    provider: executionContext.provider,
    model: executionContext.model,
    messageLength: message.length,
    hasTools: !!tools,
    toolCount: tools?.length || 0
  })

  console.log(`[llmRequestNode] About to call llmService.chat()`)

  // Call LLM service - it handles everything!
  const result = await llmService.chat({
    message,
    tools,
    context: executionContext,
    flowAPI: flow
  })

  console.log(`[llmRequestNode] llmService.chat() returned`)

  flow.log.debug('LLM service response', {
    hasError: !!result.error,
    error: result.error,
    textLength: result.text?.length || 0,
    messageHistoryLength: result.updatedContext.messageHistory.length
  })

  if (result.error) {
    flow.log.error('ERROR from LLM service', { error: result.error })
    return {
      context: result.updatedContext,
      status: 'error',
      error: result.error
    }
  }

  flow.log.info('SUCCESS', {
    responseLength: result.text.length,
    responsePreview: result.text.substring(0, 100) + '...'
  })

  // TODO: Report usage via flow.usage.report() when llmService provides usage data

  console.log(`[llmRequestNode] About to return from node function`)
  const returnValue = {
    context: result.updatedContext,
    data: result.text,
    status: 'success'
  }
  console.log(`[llmRequestNode] Returning:`, {
    hasContext: !!returnValue.context,
    messageHistoryLength: returnValue.context?.messageHistory?.length,
    dataLength: returnValue.data?.length,
    status: returnValue.status
  })
  return returnValue
}

