/**
 * OpenRouter provider using the OpenAI-compatible core.
 *
 * OpenRouter is fully compatible with the OpenAI Chat Completions API.
 * This thin wrapper configures the core provider with OpenRouter-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
 * - Supports reasoning via OpenRouter's reasoning API
 * - Captures Gemini 3 thought signatures for multi-step function calling
 *
 * Reference: https://openrouter.ai/docs
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'

/**
 * OpenRouter provider adapter using the OpenAI-compatible core.
 *
 * Uses the OpenRouter API at https://openrouter.ai/api/v1
 */
export const OpenRouterOpenAIProvider = createOpenAICompatibleProvider({
  id: 'openrouter-openai',
  baseURL: 'https://openrouter.ai/api/v1',
  
  // OpenRouter requires HTTP-Referer and X-Title headers for attribution
  defaultHeaders: {
    'HTTP-Referer': 'https://hifide.app',
    'X-Title': 'HiFide'
  },

  // Configure OpenRouter-specific request parameters
  requestModifier: (body) => {
    const modified: any = { ...body }
    
    // Enable reasoning for models that support it
    // OpenRouter uses the `reasoning` parameter
    modified.reasoning = { enabled: true }
    
    return modified
  },

  // Process streaming chunks for OpenRouter-specific fields
  chunkProcessor: (chunk) => {
    const result: any = {}
    
    // Capture Gemini 3 thought signature from extra_content
    // This is required for Gemini 3 models during multi-step function calling
    const chunkAny = chunk as any
    if (chunkAny?.extra_content?.google?.thought_signature) {
      result.thoughtSignature = chunkAny.extra_content.google.thought_signature
    }
    
    return result
  }
})

export default OpenRouterOpenAIProvider

