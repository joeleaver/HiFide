import type { MainFlowContext } from '../types'
import { getDefaultModelOverrides } from '../../data/defaultModelSettings'

export interface SamplingControls {
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  includeThoughts?: boolean
  thinkingBudget?: number
  modelSupportsThinking: boolean
}

interface SamplingOptionsInput {
  provider: string
  model: string
  workingContext: MainFlowContext | (MainFlowContext & Record<string, any>)
  requestReasoningEffort?: 'low' | 'medium' | 'high'
}

export function resolveSamplingControls(options: SamplingOptionsInput): SamplingControls {
  const { provider, model, workingContext, requestReasoningEffort } = options
  const jsonDefaults = getDefaultModelOverrides(provider, model)
  const modelOverrides: Array<{
    model: string
    temperature?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
    includeThoughts?: boolean
    thinkingBudget?: number
  }> = ((workingContext as any)?.modelOverrides || [])

  const modelOverride = modelOverrides.find((override) => override.model === model)

  let temperature: number | undefined
  if (modelOverride?.temperature !== undefined) {
    temperature = modelOverride.temperature
  } else if (typeof (workingContext as any)?.temperature === 'number') {
    const normalized = (workingContext as any).temperature
    if (provider === 'anthropic') {
      temperature = Math.min(normalized, 1)
    } else {
      temperature = normalized * 2
    }
  } else if (typeof jsonDefaults?.temperature === 'number') {
    temperature = jsonDefaults.temperature
  }

  const reasoningEffort =
    requestReasoningEffort ??
    modelOverride?.reasoningEffort ??
    (workingContext as any)?.reasoningEffort ??
    jsonDefaults?.reasoningEffort

  const isGeminiWithThinking = provider === 'gemini' && /(2\.5|[^0-9]3[.-])/i.test(model)
  const isAnthropicWithThinking = provider === 'anthropic' && (
    /claude-4/i.test(model) ||
    /claude-opus-4/i.test(model) ||
    /claude-sonnet-4/i.test(model) ||
    /claude-haiku-4/i.test(model) ||
    /claude-3-7-sonnet/i.test(model) ||
    /claude-3\.7/i.test(model) ||
    /claude-3-5-sonnet/i.test(model) ||
    /claude-3\.5-sonnet/i.test(model)
  )
  const modelSupportsThinking = isGeminiWithThinking || isAnthropicWithThinking

  const includeThoughtsOverride = modelOverride?.includeThoughts
  const includeThoughtsDefault = (workingContext as any)?.includeThoughts
  const includeThoughts = includeThoughtsOverride === true ||
    (includeThoughtsOverride !== false && includeThoughtsDefault === true) ||
    (includeThoughtsOverride === undefined && includeThoughtsDefault !== false
      ? includeThoughtsDefault === true
      : (jsonDefaults?.includeThoughts === true) ||
        (jsonDefaults?.includeThoughts !== false && modelSupportsThinking)
    )

  const thinkingBudgetOverride = modelOverride?.thinkingBudget
  const thinkingBudgetDefault = (workingContext as any)?.thinkingBudget
  const thinkingBudget = typeof thinkingBudgetOverride === 'number'
    ? thinkingBudgetOverride
    : (typeof thinkingBudgetDefault === 'number'
      ? thinkingBudgetDefault
      : (typeof jsonDefaults?.thinkingBudget === 'number'
        ? jsonDefaults.thinkingBudget
        : (includeThoughts && modelSupportsThinking ? 2048 : undefined)))

  return {
    temperature,
    reasoningEffort,
    includeThoughts,
    thinkingBudget,
    modelSupportsThinking
  }
}

