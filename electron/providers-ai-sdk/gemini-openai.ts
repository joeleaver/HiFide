/**
 * Gemini provider using the OpenAI-compatible core.
 *
 * Google provides an OpenAI-compatible API endpoint for Gemini models.
 * This thin wrapper configures the core provider with Gemini-specific settings.
 *
 * Key features:
 * - Full OpenAI Chat Completions API compatibility
 * - Supports streaming, function calling, and structured outputs
 * - Supports thinking mode via reasoning_effort or extra_body.google.thinking_config
 *
 * Reference: https://ai.google.dev/gemini-api/docs/openai
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'

/**
 * Gemini provider adapter using the OpenAI-compatible endpoint.
 *
 * Uses the OpenAI-compatible endpoint at https://generativelanguage.googleapis.com/v1beta/openai
 */
export const GeminiOpenAIProvider = createOpenAICompatibleProvider({
  id: 'gemini-openai',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',

  // Gemini supports reasoning_effort for thinking mode
  // Flash models may have different support than Pro models
  requestModifier: (body, context) => {
    // Remove tool_choice and tools - we'll add them back if needed
    const { tool_choice, tools, temperature, ...rest } = body

    const isFlash = context.model.includes('flash')

    // Flash models might not support thinking mode or have different temp limits
    // For flash, use lower temperature and skip thinking options
    const modified: any = {
      ...rest,
      // Flash seems more sensitive to high temperatures
      temperature: isFlash ? Math.min(temperature ?? 1, 0.7) : temperature
    }

    // Only include tools-related fields if we actually have tools
    if (context.hasTools && tools) {
      modified.tools = tools
      modified.tool_choice = 'auto'
    }

    return modified
  }
})

export default GeminiOpenAIProvider

