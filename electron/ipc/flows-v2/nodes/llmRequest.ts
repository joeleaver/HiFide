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
  let message = dataIn as string | undefined
  if (message === undefined) {
    message = inputs.has('data') ? await inputs.pull('data') : ''
  }

  // Resolve context with a strict preference for the connected branch context when available
  // Rationale: when a context edge is connected (and unambiguous), that branch's provider/model must win
  let executionContext: MainFlowContext | undefined
  let contextSource: 'pulled' | 'pushed' | 'config' = 'config'

  // Prefer pushed context when present; otherwise pull if unambiguous; otherwise create from config
  const ensureProviderModel = (ctx: MainFlowContext | undefined) => {
    if (!ctx) return ctx
    if (!ctx.provider || !ctx.model) {
      const provider = (config.provider as string) || 'openai'
      const model = (config.model as string) || 'gpt-4o'
      return flow.context.update(ctx, { provider, model })
    }
    return ctx
  }

  if (context) {
    executionContext = ensureProviderModel(context)
    contextSource = 'pushed'
  } else if (inputs.has('context')) {
    try {
      executionContext = ensureProviderModel(await inputs.pull('context'))
      contextSource = 'pulled'
    } catch {
      // If pull fails (ambiguous/missing), fall back to config below
    }
  }

  if (!executionContext) {
    // No usable context edge; create from node config
    const provider = (config.provider as string) || 'openai'
    const model = (config.model as string) || 'gpt-4o'
    executionContext = flow.context.create({ provider, model, systemInstructions: '' })
    contextSource = 'config'
    flow.log.debug('No context provided/usable, created from config', {
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
    contextSource,
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
    // Update provider/model first
    executionContext = flow.context.update(executionContext, {
      provider: config.overrideProvider as string,
      model: config.overrideModel as string
    })

    // Optional sampling + reasoning overrides scoped to this request
    const overrideTemperature = (config as any)?.overrideTemperature as number | undefined
    const overrideReasoningEffort = (config as any)?.overrideReasoningEffort as ('low'|'medium'|'high') | undefined
    if (typeof overrideTemperature === 'number' || overrideReasoningEffort) {
      executionContext = flow.context.update(executionContext, {
        ...(typeof overrideTemperature === 'number' ? { temperature: overrideTemperature } : {}),
        ...(overrideReasoningEffort ? { reasoningEffort: overrideReasoningEffort } : {}),
      })
    }

    flow.log.debug('Override enabled', {
      provider: executionContext.provider,
      model: executionContext.model,
      temperature: (executionContext as any).temperature,
      reasoningEffort: (executionContext as any).reasoningEffort,
    })
  } else {
    flow.log.debug('Using context provider/model', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  }

  // Pull tools if connected (lazy evaluation)
  const tools = inputs.has('tools') ? await inputs.pull('tools') : undefined

  // Call LLM service - it handles everything!
  const result = await llmService.chat({
    message,
    tools,
    context: executionContext,
    flowAPI: flow
  })

  if (result.error) {
    flow.log.error('ERROR from LLM service', { error: result.error })
    return {
      context: result.updatedContext,
      status: 'error',
      error: result.error
    }
  }

  return {
    context: result.updatedContext,
    data: result.text,
    status: 'success' as const
  }
}

