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
  type ReasoningExtractorResult,
  type ReasoningState,
} from './core/openai-compatible'
import { supportsExtendedThinking } from '../../shared/model-capabilities'

/**
 * Extract thinking content from <think> or <thought> tags in the text.
 * Gemini returns thinking wrapped in <think>...</think> or <thought>...</thought> tags within the regular text content.
 */
function extractThinkTags(text: string, state: ReasoningState): ReasoningExtractorResult {
  const DEBUG = process.env.HF_DEBUG_GEMINI_THINK === '1'
  if (DEBUG) {
    console.log('[extractThinkTags] Input:', { text: text.slice(0, 100), state })
  }

  let reasoning = ''
  let textContent = text
  let newState = { ...state }

  // Check if we're inside a think/thought tag from a previous chunk
  if (state.insideTag && (state.tagName === 'think' || state.tagName === 'thought')) {
    // We're continuing a think/thought tag from a previous chunk
    const endMatch = text.match(new RegExp(`^(.*?)</${state.tagName}>`))
    if (endMatch) {
      // Found the closing tag
      reasoning = state.buffer + endMatch[1]
      textContent = text.slice(endMatch[0].length)
      newState = { buffer: '', insideTag: false, tagName: '' }
      return {
        text: textContent,
        reasoning,
        state: newState
      }
    } else {
      // Still inside the tag
      newState = { buffer: state.buffer + text, insideTag: true, tagName: state.tagName }
      return {
        text: '',
        reasoning: '',
        state: newState
      }
    }
  }

  // Look for <think>...</think> or <thought>...</thought> tags and extract their content
  const regex = /<(think|thought)>(.*?)<\/\1>/gs
  let match
  let lastIndex = 0

  while ((match = regex.exec(text)) !== null) {
    reasoning += match[2]
    lastIndex = match.index + match[0].length
  }

  // Check if there's an opening tag without a closing tag (at the end of the text)
  const openMatch = text.match(/<(think|thought)>([^]*?)$/)
  if (openMatch && openMatch.index !== undefined && openMatch.index >= lastIndex) {
    // This is a new opening tag (not part of a completed tag we already processed)
    reasoning += openMatch[2]
    textContent = text.slice(0, openMatch.index)
    newState = { buffer: openMatch[2], insideTag: true, tagName: openMatch[1] }
    return {
      text: textContent,
      reasoning,
      state: newState
    }
  }

  // Remove all think/thought tags from the text
  textContent = text.replace(/<(think|thought)>.*?<\/\1>/gs, '')
  newState = { buffer: '', insideTag: false, tagName: '' }

  if (DEBUG) {
    console.log('[extractThinkTags] Output:', { text: textContent.slice(0, 100), reasoning: reasoning.slice(0, 100), state: newState })
  }

  return {
    text: textContent,
    reasoning,
    state: newState
  }
}

/**
 * Gemini provider adapter using the OpenAI-compatible endpoint.
 *
 * Uses the OpenAI-compatible endpoint at https://generativelanguage.googleapis.com/v1beta/openai
 */
export const GeminiOpenAIProvider = createOpenAICompatibleProvider({
  id: 'gemini',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',

  // Extract thinking from Gemini's response format
  // Gemini returns thinking wrapped in <think>...</think> tags within the regular text content
  reasoningExtractor: extractThinkTags,

  // Gemini supports reasoning_effort for thinking mode
  // Flash models may have different support than Pro models
  requestModifier: (body, context) => {
    // Remove tool_choice and tools - we'll add them back if needed
    const { tool_choice, tools, temperature, ...rest } = body

    const isFlash = context.model.includes('flash')

    // Build the modified request
    const modified: any = {
      ...rest,
      // Flash seems more sensitive to high temperatures
      temperature: isFlash ? Math.min(temperature ?? 1, 0.7) : temperature
    }

    // Enable thinking mode for models that support it
    if (supportsExtendedThinking(context.model) && context.includeThoughts) {
      // Map reasoning_effort to Gemini's thinking_budget
      // OpenAI reasoning_effort: low, medium, high
      // Gemini thinking_budget: 1024 (low), 8192 (medium), 24576 (high)
      let thinkingBudget = 1024 // default to low
      if (context.reasoningEffort === 'medium') {
        thinkingBudget = 8192
      } else if (context.reasoningEffort === 'high') {
        thinkingBudget = 24576
      }

      // Use thinkingBudget from context if provided (takes precedence)
      if (typeof context.thinkingBudget === 'number' && context.thinkingBudget > 0) {
        thinkingBudget = context.thinkingBudget
      }

      // Add thinking config via extra_body for Gemini
      modified.extra_body = {
        google: {
          thinking_config: {
            thinking_budget: thinkingBudget,
            include_thoughts: true
          }
        }
      }
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

