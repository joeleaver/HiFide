/**
 * Model Capabilities - Centralized detection for reasoning and thinking support
 *
 * This module provides a single source of truth for model capability detection.
 * All code should use these functions instead of hardcoding regex patterns.
 */

/**
 * Check if a model supports reasoning effort (low/medium/high)
 * Used by: OpenAI o1/o3, Anthropic thinking, Gemini thinking, Fireworks, OpenRouter
 */
export function supportsReasoningEffort(model: string): boolean {
  if (!model) return false
  const lowerModel = model.toLowerCase()

  // OpenAI: o1, o3, gpt-5.x models
  if (/^o[135](-|$)|^gpt-5/i.test(model)) return true

  // Anthropic: Claude thinking models (4.x, 3.7+, 3.5 Sonnet)
  if (/claude-4/i.test(model) || /claude-opus-4/i.test(model) ||
      /claude-sonnet-4/i.test(model) || /claude-haiku-4/i.test(model) ||
      /claude-3-7-sonnet/i.test(model) || /claude-3\.7/i.test(model) ||
      /claude-3-5-sonnet/i.test(model) || /claude-3\.5-sonnet/i.test(model)) return true

  // Gemini: 2.5+ and 3.x models (match gemini-2.5-*, gemini-3-flash, gemini-3.0-*, etc.)
  if (/gemini.*?(2\.5|(?:^|-)3[-.])/i.test(model)) return true

  // Fireworks: all models support reasoning
  if (/^accounts\/fireworks/i.test(model)) return true

  // OpenRouter: all models can support reasoning (depends on underlying model)
  if (lowerModel.startsWith('openrouter/') || lowerModel.includes('openrouter')) return true

  return false
}

/**
 * Check if a model supports extended thinking (Claude, Gemini)
 * Used by: Anthropic Claude 3.5+, Gemini 2.5+
 */
export function supportsExtendedThinking(model: string): boolean {
  if (!model) return false
  const lowerModel = model.toLowerCase()

  // Handle OpenRouter models
  const isOpenRouter = lowerModel.startsWith('openrouter/') || lowerModel.includes('openrouter')
  const cleanModel = isOpenRouter ? model.replace(/^openrouter\//i, '') : model

  // Gemini 2.5+ or 3+ (match gemini-2.5-*, gemini-3-flash, gemini-3.0-*, etc.)
  if (/gemini.*?(2\.5|(?:^|-)3[-.])/i.test(cleanModel) || (isOpenRouter && /(2\.5|(?:^|-)3[-.])/i.test(cleanModel))) return true

  // Anthropic Claude 3.5+ Sonnet, 3.7+, 4+
  if (/claude-4/i.test(cleanModel) || /claude-opus-4/i.test(cleanModel) ||
      /claude-sonnet-4/i.test(cleanModel) || /claude-haiku-4/i.test(cleanModel) ||
      /claude-3-7-sonnet/i.test(cleanModel) || /claude-3\.7/i.test(cleanModel) ||
      /claude-3-5-sonnet/i.test(cleanModel) || /claude-3\.5-sonnet/i.test(cleanModel)) return true

  return false
}

/**
 * Check if a provider/model combination supports reasoning persistence
 * Used by: Message formatting for re-injecting reasoning across turns
 */
export function supportsReasoningPersistence(provider: string, model: string): boolean {
  if (!provider || !model) return false

  if (provider === 'openai') {
    // OpenAI o1, o3, gpt-5.x models support reasoning
    return /^o[135](-|$)|^gpt-5/i.test(model)
  }

  if (provider === 'anthropic') {
    // Claude 4.x, Claude 3.7+, Claude 3.5 Sonnet support thinking
    return /claude-4/i.test(model) || /claude-opus-4/i.test(model) ||
           /claude-sonnet-4/i.test(model) || /claude-haiku-4/i.test(model) ||
           /claude-3-7-sonnet/i.test(model) || /claude-3\.7/i.test(model) ||
           /claude-3-5-sonnet/i.test(model) || /claude-3\.5-sonnet/i.test(model)
  }

  if (provider === 'gemini') {
    // Gemini 2.5+ and 3.x models support thinking
    return /gemini.*?(2\.5|(?:^|-)3\.)/i.test(model)
  }

  // Fireworks and OpenRouter support all models
  if (provider === 'fireworks' || provider === 'openrouter') {
    return true
  }

  return false
}

/**
 * Get the provider from a model ID (heuristic)
 * Useful for UI components that need to determine provider without explicit context
 */
export function getProviderFromModel(model?: string): 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter' | 'unknown' {
  if (!model) return 'unknown'
  const lowerModel = model.toLowerCase().trim()

  // Check for explicit provider prefixes first
  if (lowerModel.includes(':')) {
    const prefix = lowerModel.split(':')[0].trim()
    if (prefix === 'openrouter') return 'openrouter'
    if (prefix === 'openai') return 'openai'
    if (prefix === 'anthropic') return 'anthropic'
    if (prefix === 'gemini' || prefix === 'google') return 'gemini'
    if (prefix === 'fireworks') return 'fireworks'
    if (prefix === 'xai') return 'xai'
  }

  if (lowerModel.startsWith('openrouter/') || lowerModel.includes('openrouter')) return 'openrouter'
  if (/^(gpt-|o[135]|chatgpt|text-|dall-e|whisper|tts)/i.test(model)) return 'openai'
  if (/^claude/i.test(model)) return 'anthropic'
  if (/^gemini/i.test(model)) return 'gemini'
  if (/^grok/i.test(model)) return 'xai'
  if (/^accounts\/fireworks/i.test(model)) return 'fireworks'
  return 'unknown'
}

