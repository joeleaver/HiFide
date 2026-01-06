/**
 * xAI (Grok) provider using the OpenAI-compatible core.
 *
 * xAI provides an OpenAI-compatible API endpoint for Grok models.
 * This thin wrapper configures the core provider with xAI-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
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

  // xAI is fully OpenAI-compatible, no special modifications needed
  requestModifier: (body) => {
    // Just pass through - xAI handles standard OpenAI format
    return body
  }
})

export default XAIOpenAIProvider

