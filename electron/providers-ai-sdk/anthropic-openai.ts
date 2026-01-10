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
 * Caching: Anthropic requires explicit cache_control breakpoints. The core
 * provider adds these automatically to the last tool definition and system
 * message when using Anthropic models.
 *
 * NOTE: Anthropic's OpenAI-compatible API does NOT support prompt caching.
 * For caching support, use Anthropic models via OpenRouter instead, which
 * does support cache_control breakpoints.
 *
 * Reference: https://docs.anthropic.com/en/api/openai-sdk
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'
import { supportsExtendedThinking } from '../../shared/model-capabilities'

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
    if (context.includeThoughts && supportsExtendedThinking(context.model)) {
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

