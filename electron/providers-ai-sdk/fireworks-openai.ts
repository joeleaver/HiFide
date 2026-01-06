/**
 * Fireworks provider using the OpenAI-compatible core.
 * 
 * Fireworks AI provides an OpenAI-compatible API endpoint.
 * This thin wrapper configures the core provider with Fireworks-specific settings.
 * 
 * Key features:
 * - Extracts <think>...</think> reasoning blocks from DeepSeek and similar models
 * - Filters out "None" artifacts common with reasoning models
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

  // Add reasoning parameter like OpenRouter does
  requestModifier: (body) => ({
    ...body,
  })

  // Extract <think> tags from streaming responses
  //reasoningExtractor: extractThinkTags
})

export default FireworksOpenAIProvider

