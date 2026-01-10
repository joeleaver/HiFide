/**
 * xAI (Grok) provider using the OpenAI-compatible core.
 *
 * xAI provides an OpenAI-compatible API endpoint for Grok models.
 * This thin wrapper configures the core provider with xAI-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
 * - Automatic prompt caching with conversation ID for improved cache hits
 *
 * Caching: xAI has automatic prefix caching. Using the x-grok-conv-id header
 * with a consistent conversation ID increases the likelihood of cache hits
 * across requests in the same conversation.
 *
 * Reference: https://docs.x.ai/api
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'

/**
 * xAI provider adapter using the OpenAI-compatible core.
 *
 * Uses the xAI API at https://api.x.ai/v1
 */
export const XAIOpenAIProvider = createOpenAICompatibleProvider({
  id: 'xai',
  baseURL: 'https://api.x.ai/v1',

  // Conversation ID header for better cache hits
  // See: https://docs.x.ai/docs/key-information/consumption-and-rate-limits
  getSessionHeaders: (context) => {
    if (context.sessionId) {
      return { 'x-grok-conv-id': context.sessionId }
    }
    return undefined
  }
})

export default XAIOpenAIProvider

