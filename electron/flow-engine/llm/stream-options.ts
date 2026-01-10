import type { MainFlowContext } from '../types'
import { getDefaultModelOverrides } from '../../data/defaultModelSettings'
import { supportsExtendedThinking } from '../../../shared/model-capabilities'

export interface SamplingControls {
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  includeThoughts?: boolean
  thinkingBudget?: number
  modelSupportsThinking: boolean
  /** Gemini caching mode: 'explicit' (default) for guaranteed savings, 'implicit' for automatic caching */
  geminiCacheMode?: 'explicit' | 'implicit'
  /** Gemini explicit cache refresh threshold in tokens (default: 500). Cache is rebuilt when fresh content exceeds this. */
  geminiCacheRefreshThreshold?: number
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
    if (provider === 'anthropic' || provider === 'openrouter') {
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

  const modelSupportsThinking = supportsExtendedThinking(model)

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

  // Gemini cache mode: 'explicit' (default) or 'implicit'
  // Only applies to Gemini provider - explicit caching gives guaranteed savings,
  // implicit relies on Gemini's automatic (probabilistic) caching
  const geminiCacheModeOverride = (modelOverride as any)?.geminiCacheMode as 'explicit' | 'implicit' | undefined
  const geminiCacheModeDefault = (workingContext as any)?.geminiCacheMode as 'explicit' | 'implicit' | undefined
  const geminiCacheMode: 'explicit' | 'implicit' | undefined =
    geminiCacheModeOverride ?? geminiCacheModeDefault ?? (jsonDefaults as any)?.geminiCacheMode

  // Gemini cache refresh threshold: token count at which to rebuild cache mid-loop
  const geminiCacheRefreshThresholdOverride = (modelOverride as any)?.geminiCacheRefreshThreshold as number | undefined
  const geminiCacheRefreshThresholdDefault = (workingContext as any)?.geminiCacheRefreshThreshold as number | undefined
  const geminiCacheRefreshThreshold: number | undefined =
    geminiCacheRefreshThresholdOverride ?? geminiCacheRefreshThresholdDefault ?? (jsonDefaults as any)?.geminiCacheRefreshThreshold

  return {
    temperature,
    reasoningEffort,
    includeThoughts,
    thinkingBudget,
    modelSupportsThinking,
    geminiCacheMode,
    geminiCacheRefreshThreshold
  }
}

