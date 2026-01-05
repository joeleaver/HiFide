/**
 * Anthropic provider using the OpenAI-compatible core.
 *
 * Anthropic provides an OpenAI-compatible API endpoint.
 * This thin wrapper configures the core provider with Anthropic-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
 * - Supports extended thinking for Claude 3.5+ Sonnet, 3.7+, and 4+
 *
 * Reference: https://docs.anthropic.com/en/api/openai-sdk
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'

// Models that support extended thinking (Claude 3.5+ Sonnet, Claude 3.7+, Claude 4+)
const supportsThinking = (id: string) => {
  // Claude 4.x models
  if (/claude-4/i.test(id) || /claude-opus-4/i.test(id) || /claude-sonnet-4/i.test(id) || /claude-haiku-4/i.test(id)) return true
  // Claude 3.7 Sonnet
  if (/claude-3-7-sonnet/i.test(id) || /claude-3\.7/i.test(id)) return true
  // Claude 3.5 Sonnet (not Haiku - 3.5 Haiku doesn't support thinking)
  if (/claude-3-5-sonnet/i.test(id) || /claude-3\.5-sonnet/i.test(id)) return true
  return false
}

/**
 * Anthropic provider adapter using the OpenAI-compatible core.
 *
 * Uses the Anthropic OpenAI-compatible API at https://api.anthropic.com/v1
 */
export const AnthropicOpenAIProvider = createOpenAICompatibleProvider({
  id: 'anthropic',
  baseURL: 'https://api.anthropic.com/v1',

  // Configure Anthropic-specific request parameters
  requestModifier: (body, context) => {
    const modified: any = { ...body }
    
    // Enable extended thinking for supported models
    if (context.includeThoughts && supportsThinking(context.model)) {
      // Anthropic uses the thinking parameter in their OpenAI-compatible API
      const budgetTokens = typeof context.thinkingBudget === 'number' && context.thinkingBudget !== -1
        ? context.thinkingBudget
        : 2048
      modified.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens
      }
    }
    
    return modified
  }
})

export default AnthropicOpenAIProvider

