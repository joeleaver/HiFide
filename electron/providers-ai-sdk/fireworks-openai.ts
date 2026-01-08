/**
 * Fireworks provider using the OpenAI-compatible core.
 *
 * Fireworks AI provides an OpenAI-compatible API endpoint.
 * This thin wrapper configures the core provider with Fireworks-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
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
})

export default FireworksOpenAIProvider

