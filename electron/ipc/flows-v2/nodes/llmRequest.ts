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

  // Apply override if enabled (provider and/or model)
  if (config.overrideEnabled as boolean) {
    const requestedProvider = (config.overrideProvider as string | undefined) || undefined
    let requestedModel = (config.overrideModel as string | undefined) || undefined

    // If provider is overridden but model is not, pick a sane default from store
    if (requestedProvider && !requestedModel) {
      try {
        const state: any = (flow as any).store
        const preferred = state.defaultModels?.[requestedProvider]
        const models = state.modelsByProvider?.[requestedProvider] || []
        const hasPreferred = preferred && models.some((m: any) => m.value === preferred)
        if (hasPreferred) {
          requestedModel = preferred
        } else if (models.length > 0) {
          requestedModel = models[0].value
        }
      } catch {}
    }

    // Fallback: if still missing a model, keep current model to avoid null
    if (requestedProvider && !requestedModel) {
      try {
        flow.log.warn('Override provider set without model and no default found; keeping current model (may be invalid for new provider)', {
          requestedProvider,
          currentModel: executionContext.model
        })
      } catch {}
    }
    const appliedProvider = requestedProvider || executionContext.provider
    const appliedModel = requestedModel || executionContext.model

    // Update provider/model and optional sampling/reasoning
    executionContext = flow.context.update(executionContext, {
      provider: appliedProvider,
      model: appliedModel
    })

    const overrideTemperature = (config as any)?.overrideTemperature as number | undefined
    const overrideReasoningEffort = (config as any)?.overrideReasoningEffort as ('low'|'medium'|'high') | undefined
    if (typeof overrideTemperature === 'number' || overrideReasoningEffort) {
      executionContext = flow.context.update(executionContext, {
        ...(typeof overrideTemperature === 'number' ? { temperature: overrideTemperature } : {}),
        ...(overrideReasoningEffort ? { reasoningEffort: overrideReasoningEffort } : {}),
      })
    }

    flow.log.debug('Override resolved', {
      requestedProvider,
      requestedModel,
      appliedProvider: executionContext.provider,
      appliedModel: executionContext.model,
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
  try {
    flow.log.debug('llmRequest: pulled tools', {
      toolsCount: Array.isArray(tools) ? tools.length : (tools ? 'non-array' : 0),
      toolNames: Array.isArray(tools) ? tools.map((t: any) => t?.name).filter(Boolean).slice(0, 12) : undefined
    })
  } catch {}
  try {
    flow.log.debug('llmRequest: about to call llmService.chat', {
      provider: executionContext?.provider,
      model: executionContext?.model,
      messageLength: typeof message === 'string' ? message.length : undefined
    })
  } catch {}


  // Call LLM service - it handles everything!
  const result = await llmService.chat({
    message,
    tools,
    context: executionContext,
    flowAPI: flow,
    ...(config.overrideEnabled && (config.overrideProvider || config.overrideModel)
      ? {
          ...(config.overrideProvider ? { overrideProvider: config.overrideProvider as string } : {}),
          ...(config.overrideModel ? { overrideModel: config.overrideModel as string } : {}),
        }
      : {})
  })
  try {
    flow.log.debug('llmRequest: llmService.chat returned', {
      hasError: !!(result as any)?.error,
      textLen: typeof (result as any)?.text === 'string' ? (result as any).text.length : undefined
    })
  } catch {}


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

