/**
 * Fireworks provider using the OpenAI-compatible core.
 *
 * Fireworks AI provides an OpenAI-compatible API endpoint.
 * This thin wrapper configures the core provider with Fireworks-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
 * - Automatic prompt caching with session affinity for improved cache hits
 *
 * Caching: Fireworks has automatic prefix caching enabled by default. Using the
 * x-session-affinity header routes requests with the same session ID to the same
 * replica, maximizing cache hit rates in multi-replica deployments.
 *
 * Reference: https://docs.fireworks.ai/guides/prompt-caching
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'

/**
 * Fireworks AI provider adapter.
 *
 * Uses the OpenAI-compatible endpoint at https://api.fireworks.ai/inference/v1
 */
export const FireworksOpenAIProvider = createOpenAICompatibleProvider({
  id: 'fireworks',
  baseURL: 'https://api.fireworks.ai/inference/v1',

  // Session affinity header for better cache hits across multi-replica deployments
  // See: https://docs.fireworks.ai/guides/prompt-caching#session-affinity-for-multi-replica-deployments
  getSessionHeaders: (context) => {
    if (context.sessionId) {
      return { 'x-session-affinity': context.sessionId }
    }
    return undefined
  }
})

export default FireworksOpenAIProvider

