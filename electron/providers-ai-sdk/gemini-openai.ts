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
 * Caching: This provider uses EXPLICIT caching via Gemini's Context Caching API.
 * - Creates a cache with system instructions and tools at the start of each session
 * - References the cache in all subsequent requests via extra_body.google.cached_content
 * - Guarantees 75-90% cost savings (vs implicit caching which is probabilistic)
 * - Cache TTL: 1 hour (automatically renewed per session)
 *
 * Token minimums for explicit caching:
 * - Flash models: 1024 tokens minimum
 * - Pro models: 2048-4096 tokens minimum
 *
 * Reference: https://ai.google.dev/gemini-api/docs/openai
 * Caching: https://ai.google.dev/api/caching
 */
import {
  createOpenAICompatibleProvider,
  type ReasoningExtractorResult,
  type ReasoningState,
  type CacheContext,
} from './core/openai-compatible'
import { supportsExtendedThinking } from '../../shared/model-capabilities'
import {
  createGeminiCache,
  geminiCacheStore
} from './gemini-cache-manager'

// Minimum tokens for explicit caching eligibility
const MIN_CACHE_TOKENS = 2048

// Cache TTL in seconds (1 hour)
const CACHE_TTL_SECONDS = 3600

/**
 * Estimate token count from text
 */
function estimateTokens(text: string | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Get or create an explicit cache for Gemini.
 *
 * Checks the in-memory cache store first. If no valid cache exists,
 * creates a new one with the system instructions and tools.
 *
 * If geminiCacheMode is 'implicit', returns null to skip explicit caching
 * and rely on Gemini's automatic (probabilistic) caching instead.
 */
async function getOrCreateGeminiCache(context: CacheContext): Promise<string | null> {
  const { apiKey, model, systemInstruction, tools, sessionId, geminiCacheMode } = context

  // Skip explicit caching if mode is 'implicit' - rely on Gemini's automatic caching
  if (geminiCacheMode === 'implicit') {
    if (process.env.HF_DEBUG_GEMINI_CACHE === '1') {
      console.log(`[gemini] Using implicit caching mode (automatic, probabilistic)`)
    }
    return null
  }

  // Use a fallback session ID if none provided
  const effectiveSessionId = sessionId || 'default'

  // Check for existing valid cache
  const existingCache = geminiCacheStore.get(effectiveSessionId, model)
  if (existingCache) {
    return existingCache.name
  }

  // Estimate tokens to check if we meet minimum
  let totalTokens = estimateTokens(systemInstruction)
  if (tools?.length) {
    totalTokens += estimateTokens(JSON.stringify(tools))
  }

  // Skip caching if content is too small
  if (totalTokens < MIN_CACHE_TOKENS) {
    if (process.env.HF_DEBUG_GEMINI_CACHE === '1') {
      console.log(`[gemini] Skipping cache: ${totalTokens} tokens < ${MIN_CACHE_TOKENS} minimum`)
    }
    return null
  }

  // Create a new cache
  try {
    const cacheRef = await createGeminiCache({
      apiKey,
      model,
      systemInstruction,
      tools,
      ttlSeconds: CACHE_TTL_SECONDS,
      displayName: `hifide-session-${effectiveSessionId.slice(0, 8)}`
    })

    // Store in memory for future requests in this session
    geminiCacheStore.set(effectiveSessionId, model, cacheRef)

    if (process.env.HF_DEBUG_GEMINI_CACHE === '1') {
      console.log(`[gemini] Created cache: ${cacheRef.name} (${cacheRef.totalTokenCount} tokens)`)
    }

    return cacheRef.name
  } catch (err: any) {
    // Log but don't fail - we can continue without caching
    console.warn(`[gemini] Cache creation failed:`, err?.message || err)
    return null
  }
}

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

  // Explicit caching hook - creates/retrieves a cache before the agentic loop
  // This guarantees cost savings (90% on 2.5 models, 75% on 2.0)
  getCacheId: getOrCreateGeminiCache,

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

