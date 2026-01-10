/**
 * Core OpenAI-compatible provider factory.
 *
 * This module provides a factory function to create provider adapters for any
 * OpenAI-compatible API. The OpenRouter provider is the reference implementation,
 * and other providers (Fireworks, xAI, OpenAI direct, etc.) are thin wrappers.
 */
import OpenAI from 'openai'
import * as fs from 'fs'
import { UiPayloadCache } from '../../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../../src/store/utils/constants'
import type { ProviderAdapter, StreamHandle, AgentTool } from '../../providers/provider'
import { rateLimitTracker } from '../../providers/rate-limit-tracker'

// Re-export types for convenience
export type { ProviderAdapter, StreamHandle, AgentTool }

const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

// Rate limiting constants for per-step retries within the agentic loop
const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

/**
 * Check if an error is a rate limit error (HTTP 429)
 */
function isRateLimitError(err: any): boolean {
  if (err?.status === 429) return true
  if (err?.error?.status === 429) return true
  const msg = String(err?.message || '').toLowerCase()
  return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')
}

/**
 * Calculate backoff delay with exponential increase and jitter
 */
function calculateBackoff(attempt: number): number {
  const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
  const cappedDelay = Math.min(exponentialDelay, MAX_BACKOFF_MS)
  const jitter = cappedDelay * 0.2 * (Math.random() - 0.5)
  return Math.round(cappedDelay + jitter)
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Configuration for an OpenAI-compatible provider.
 */
export interface ProviderConfig {
  /** Unique provider identifier */
  id: string
  /** Base URL for the API (e.g., 'https://api.fireworks.ai/inference/v1') */
  baseURL: string
  /** Default headers to include with every request */
  defaultHeaders?: Record<string, string>
  /**
   * Hook to modify the request body before sending.
   * Use this to add provider-specific parameters.
   */
  requestModifier?: (body: any, context: RequestContext) => any
  /**
   * Hook to process streaming chunks for provider-specific fields.
   * Return extracted reasoning content or thought signatures.
   */
  chunkProcessor?: (chunk: any, delta: any, context: ChunkContext) => ChunkProcessorResult
  /**
   * Hook to extract reasoning from text content (e.g., <think> tags).
   * If provided, text deltas will be passed through this function.
   */
  reasoningExtractor?: (text: string, state: ReasoningState) => ReasoningExtractorResult
  /**
   * Hook to get per-request headers for session affinity/caching.
   * Used by providers like Fireworks (x-session-affinity) and xAI (x-grok-conv-id).
   */
  getSessionHeaders?: (context: RequestContext) => Record<string, string> | undefined
  /**
   * If true, omit stream_options from requests (for providers that don't support it).
   * Default: false (include stream_options: { include_usage: true })
   */
  omitStreamOptions?: boolean
  /**
   * Hook to create/retrieve an explicit cache before the agentic loop.
   * If provided, the returned cache ID will be included in extra_body for all requests.
   * Used by Gemini for explicit caching (90% cost savings on 2.5 models).
   *
   * @param context - Cache context with API key, model, system, tools
   * @returns Promise resolving to cache ID (e.g., "cachedContents/xxx") or null to skip caching
   */
  getCacheId?: (context: CacheContext) => Promise<string | null>
}

/**
 * Context for cache creation/retrieval
 */
export interface CacheContext {
  /** API key for cache API calls */
  apiKey: string
  /** Model name */
  model: string
  /** System instructions */
  systemInstruction?: string
  /** Tools in OpenAI format */
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: any
    }
  }>
  /** Session ID for cache key management */
  sessionId?: string
  /** Cache mode: 'explicit' (default) for guaranteed savings, 'implicit' for automatic caching */
  geminiCacheMode?: 'explicit' | 'implicit'
}

export interface RequestContext {
  model: string
  hasTools: boolean
  temperature?: number
  reasoningEffort?: string
  includeThoughts?: boolean
  thinkingBudget?: number
  /** Session/conversation ID for cache affinity (from toolMeta.requestId) */
  sessionId?: string
}

export interface ChunkContext {
  model: string
  provider: string
}

export interface ChunkProcessorResult {
  /** Reasoning content extracted from the chunk */
  reasoning?: string
  /** Thought signature for multi-turn (e.g., Gemini 3) */
  thoughtSignature?: string
  /** Provider-specific data to emit */
  providerData?: Record<string, any>
}

export interface ReasoningState {
  buffer: string
  insideTag: boolean
  tagName: string
}

export interface ReasoningExtractorResult {
  /** Text to emit as regular content */
  text: string
  /** Reasoning to emit separately */
  reasoning: string
  /** Updated state */
  state: ReasoningState
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sanitizeName(name: string): string {
  return (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool'
}

/**
 * Clean up JSON Schema parameters for tool definitions.
 *
 * Minimal cleaning to maximize compatibility across providers while preserving
 * the original schema structure as much as possible.
 */
function cleanParameters(params: any): any {
  // Handle missing/invalid params
  if (!params || typeof params !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: []
    }
  }

  // Deep clone to avoid mutating original
  const cleaned = JSON.parse(JSON.stringify(params))

  // Ensure type is object (required by all providers)
  if (cleaned.type !== 'object') {
    cleaned.type = 'object'
  }

  // Ensure properties exists (required by most providers)
  if (!cleaned.properties || typeof cleaned.properties !== 'object') {
    cleaned.properties = {}
  }

  // Ensure required is an array (some providers require it even if empty)
  if (!Array.isArray(cleaned.required)) {
    cleaned.required = []
  }

  // Remove additionalProperties - not supported by all providers and can cause issues
  delete cleaned.additionalProperties

  // Recursively clean nested schemas (for objects with nested properties)
  function cleanNested(obj: any): void {
    if (!obj || typeof obj !== 'object') return

    delete obj.additionalProperties

    if (obj.properties && typeof obj.properties === 'object') {
      for (const key of Object.keys(obj.properties)) {
        cleanNested(obj.properties[key])
      }
    }
    if (obj.items) {
      cleanNested(obj.items)
    }
  }

  for (const key of Object.keys(cleaned.properties)) {
    cleanNested(cleaned.properties[key])
  }

  return cleaned
}

/**
 * Build tools in OpenAI function calling format.
 *
 * @param tools - Array of agent tools to convert
 * @param options.addCacheControl - If true, adds cache_control to the last tool to enable
 *   prefix caching. Supported by Anthropic and Gemini models via OpenRouter.
 */
function buildOpenAITools(
  tools: AgentTool[] | undefined,
  options?: { addCacheControl?: boolean }
): {
  openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined
  toolMap: Map<string, AgentTool>
  nameMap: Map<string, string>
} {
  if (!tools?.length) {
    return { openaiTools: undefined, toolMap: new Map(), nameMap: new Map() }
  }

  const openaiTools: any[] = []  // Use any[] to allow cache_control field
  const toolMap = new Map<string, AgentTool>()
  const nameMap = new Map<string, string>() // safe -> original

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    if (!t?.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    nameMap.set(safe, t.name)
    toolMap.set(safe, t)

    const toolDef: any = {
      type: 'function',
      function: {
        name: safe,
        description: t.description || '',
        parameters: cleanParameters(t.parameters)
        // Note: strict mode removed - let providers use their defaults
        // strict: true requires additionalProperties: false which we can't guarantee for all tools
      }
    }

    // Add cache_control to the LAST tool for Anthropic-style caching
    // This caches all tools up to and including this one
    if (options?.addCacheControl && i === tools.length - 1) {
      toolDef.cache_control = { type: 'ephemeral' }
    }

    openaiTools.push(toolDef)
  }

  return { openaiTools: openaiTools.length ? openaiTools : undefined, toolMap, nameMap }
}

/**
 * Convert a message part to OpenAI format.
 */
function convertMessagePart(part: any): any {
  if (part.type === 'text') {
    return { type: 'text', text: part.text }
  } else if (part.type === 'image') {
    const mimeType = part.mimeType || 'image/png'
    const imageData = part.image
    if (typeof imageData === 'string' && (imageData.startsWith('http') || imageData.startsWith('data:'))) {
      return { type: 'image_url', image_url: { url: imageData } }
    }
    return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData}` } }
  }
  return null
}

/**
 * Convert message content to OpenAI format.
 */
function convertMessageContent(content: any): any {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map(convertMessagePart).filter((p: any) => p !== null)
    if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
    if (parts.length === 0) return ''
    return parts
  }
  return content
}

/**
 * Convert messages to OpenAI format.
 */
function toOpenAIMessages(messages: any[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

  for (const msg of messages || []) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: convertMessageContent(msg.content) })
    } else if (msg.role === 'assistant') {
      // Preserve tool_calls from message history - required for proper conversation context
      const assistantMsg: any = { role: 'assistant', content: convertMessageContent(msg.content) }
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        assistantMsg.tool_calls = msg.tool_calls
      }
      result.push(assistantMsg)
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id || msg.toolCallId || '',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      })
    }
  }

  return result
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an OpenAI-compatible provider adapter.
 */
export function createOpenAICompatibleProvider(config: ProviderConfig): ProviderAdapter {
  const { id, baseURL, defaultHeaders, requestModifier, chunkProcessor, reasoningExtractor, getSessionHeaders, omitStreamOptions, getCacheId } = config

  return {
    id,

    async agentStream({
      apiKey,
      model,
      system,
      messages,
      temperature,
      tools,
      responseSchema,
      emit,
      onChunk: onTextChunk,
      onDone: onStreamDone,
      onError: onStreamError,
      onTokenUsage,
      toolMeta,
      onToolStart,
      onToolEnd,
      onToolError,
      onStep,
      reasoningEffort,
      includeThoughts,
      thinkingBudget,
      geminiCacheMode,
      geminiCacheRefreshThreshold: _geminiCacheRefreshThreshold
    }): Promise<StreamHandle> {
      const ac = new AbortController()

      // Create OpenAI client with provider-specific config
      const client = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders
      })

      // Build tools - add cache_control for providers that support explicit breakpoints
      // - Anthropic: explicit cache_control breakpoints (but NOT via their OpenAI-compatible API)
      // - OpenRouter: passes cache_control to underlying provider (Claude, Gemini)
      // - Gemini direct: has implicit caching (automatic), does NOT support cache_control syntax
      // - OpenAI: has automatic prefix caching, does NOT support cache_control syntax
      // See: https://openrouter.ai/docs/guides/best-practices/prompt-caching
      const supportsCacheControl = id === 'openrouter' && /claude|anthropic|gemini/i.test(model)
      const { openaiTools, toolMap, nameMap } = buildOpenAITools(tools, {
        addCacheControl: supportsCacheControl
      })
      const hasTools = !!openaiTools?.length

      // Convert messages - this array will be mutated during the agentic loop
      let conversationMessages = toOpenAIMessages(messages || [])

      // Explicit cache ID (for providers like Gemini that support it)
      let explicitCacheId: string | null = null

      // Try to get/create an explicit cache if the provider supports it
      // IMPORTANT: This must happen BEFORE adding system message, because with explicit caching
      // the system and tools are IN the cache and should NOT be in the request
      if (getCacheId) {
        try {
          explicitCacheId = await getCacheId({
            apiKey,
            model,
            systemInstruction: system,
            tools: openaiTools as any,
            sessionId: toolMeta?.requestId,
            geminiCacheMode
          })
          if (explicitCacheId) {
            console.log(`[${id}] Using explicit cache: ${explicitCacheId}`)
          }
        } catch (err: any) {
          // Cache creation failed - continue without caching
          console.warn(`[${id}] Failed to create explicit cache:`, err?.message || err)
          explicitCacheId = null
        }
      }

      // Add system message if provided - but NOT if we have an explicit cache
      // (with explicit caching, system is stored in the cache)
      if (system && !explicitCacheId) {
        if (supportsCacheControl) {
          // Use array format with cache_control breakpoint
          conversationMessages.unshift({
            role: 'system',
            content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
          } as any)
        } else {
          conversationMessages.unshift({ role: 'system', content: system })
        }
      }

      // State for reasoning extraction (will be reset each step)
      let reasoningState: ReasoningState = {
        buffer: '',
        insideTag: false,
        tagName: ''
      }

      // Agentic loop with rate limiting
      let cancelled = false
      const runLoop = async () => {
        let stepCount = 0
        let thoughtSignature: string | undefined

        // Accumulate text and reasoning across steps for consolidated reporting
        let turnText = ''
        let turnReasoning = ''

        while (stepCount < AGENT_MAX_STEPS && !cancelled) {
          stepCount++

          // Reset reasoning state for this step to prevent state corruption
          // NOTE: This is reset at the START of each step, but will be maintained
          // across all chunks within a single streaming response
          reasoningState = {
            buffer: '',
            insideTag: false,
            tagName: ''
          }

          // Progressive caching: Mark the last message as a cache breakpoint
          // This ensures each step caches all previous conversation history
          // Only do this for step 2+, and only for providers that support cache_control
          if (supportsCacheControl && stepCount > 1 && conversationMessages.length > 1) {
            const lastIdx = conversationMessages.length - 1
            const lastMsg = conversationMessages[lastIdx] as any

            // Add cache_control to the last message's content
            // This extends the cached prefix to include all previous messages
            if (lastMsg.role === 'tool') {
              // For tool messages, wrap content in array format with cache_control
              if (typeof lastMsg.content === 'string') {
                lastMsg.content = [{ type: 'text', text: lastMsg.content, cache_control: { type: 'ephemeral' } }]
              }
            } else if (lastMsg.role === 'assistant' || lastMsg.role === 'user') {
              // For user/assistant messages with string content
              if (typeof lastMsg.content === 'string') {
                lastMsg.content = [{ type: 'text', text: lastMsg.content, cache_control: { type: 'ephemeral' } }]
              } else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
                // Add cache_control to last content block
                const lastBlock = lastMsg.content[lastMsg.content.length - 1]
                if (lastBlock && !lastBlock.cache_control) {
                  lastBlock.cache_control = { type: 'ephemeral' }
                }
              }
            }
          }

          // Build request body fresh each iteration (like OpenRouter)
          // When using explicit cache, tools are IN the cache and should NOT be in the request
          const includeTools = hasTools && !explicitCacheId
          let requestBody: any = {
            model,
            messages: conversationMessages,
            tools: includeTools ? openaiTools : undefined,
            tool_choice: includeTools ? 'auto' : undefined,
            temperature: typeof temperature === 'number' ? temperature : undefined,
            stream: true,
            // Request usage stats in streaming response (required for per-step tracking)
            // Some providers may not support this - use omitStreamOptions in provider config to disable
            ...(omitStreamOptions ? {} : { stream_options: { include_usage: true } })
          }

          // Add responseSchema if provided (for structured outputs)
          if (responseSchema) {
            requestBody.response_format = {
              type: 'json_schema',
              json_schema: responseSchema
            }
          }

          // Build request context for provider hooks
          const requestContext: RequestContext = {
            model,
            hasTools,
            temperature,
            reasoningEffort,
            includeThoughts,
            thinkingBudget,
            sessionId: toolMeta?.requestId
          }

          // Apply provider-specific modifications
          if (requestModifier) {
            requestBody = requestModifier(requestBody, requestContext)
          }

          // Add explicit cache reference if available (Gemini explicit caching)
          // Put cached_content directly in the request body (not in extra_body)
          if (explicitCacheId) {
            requestBody.cached_content = explicitCacheId
          }

          // Get session-specific headers for cache affinity (Fireworks, xAI)
          const sessionHeaders = getSessionHeaders?.(requestContext)

          if (DEBUG) {
            console.log(`[${id}] Step ${stepCount}, messages: ${conversationMessages.length}`)
            // Log all messages to see what we're sending
            console.log(`[${id}] Messages:`, JSON.stringify(conversationMessages, null, 2))
            // Log the full request body
            console.log(`[${id}] Full request body:`, JSON.stringify(requestBody, null, 2))
            if (stepCount === 1 && hasTools) {
              console.log(`[${id}] Tool count: ${openaiTools!.length}`)
              // Log full tool definitions to debug parameter issues
              console.log(`[${id}] Tool definitions:`, JSON.stringify(openaiTools, null, 2))
            }
          }

          // Always log tool definitions on first step if HF_DEBUG_TOOLS=1
          if (process.env.HF_DEBUG_TOOLS === '1' && stepCount === 1 && hasTools) {
            console.log(`[${id}] === TOOL DEFINITIONS SENT TO API ===`)
            console.log(JSON.stringify(openaiTools, null, 2))
            console.log(`[${id}] === END TOOL DEFINITIONS ===`)
          }

          // Cache debug logging to file (HF_DEBUG_CACHE_FILE=1)
          if (process.env.HF_DEBUG_CACHE_FILE === '1') {
            try {
              const debugFile = '/tmp/hifide-cache-debug.json'
              let debugData: any = { steps: [] }
              try {
                if (fs.existsSync(debugFile)) {
                  debugData = JSON.parse(fs.readFileSync(debugFile, 'utf8'))
                }
              } catch {}

              const stepData = {
                timestamp: new Date().toISOString(),
                provider: id,
                model,
                stepCount,
                supportsCacheControl,
                messageCount: conversationMessages.length,
                messages: conversationMessages.map((m: any, i: number) => ({
                  index: i,
                  role: m.role,
                  contentType: typeof m.content,
                  hasToolCalls: !!(m.tool_calls?.length),
                  contentLength: typeof m.content === 'string' ? m.content.length : 0
                })),
                toolsHaveCache: openaiTools?.some((t: any) => t.cache_control) || false
              }

              debugData.steps.push(stepData)
              if (debugData.steps.length > 20) debugData.steps = debugData.steps.slice(-20)
              fs.writeFileSync(debugFile, JSON.stringify(debugData, null, 2))
            } catch {}
          }

          // Make API call with per-step retry for rate limits
          // This is the correct place for retry logic since each step is independent.
          // Service-level retry would restart the entire agentic loop, losing progress.
          let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | undefined

          // Extract extra_body from requestBody - it needs to be passed as a separate option
          // The OpenAI SDK merges extra_body into the HTTP body, but it expects it in options
          const { extra_body, ...bodyWithoutExtraBody } = requestBody

          // Debug logging for explicit cache
          if (explicitCacheId) {
            console.log(`[${id}] Request with explicit cache:`, {
              cacheId: explicitCacheId,
              cached_content_in_body: bodyWithoutExtraBody.cached_content || 'not set',
              messageCount: conversationMessages.length
            })
          }

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            if (cancelled || ac.signal.aborted) break
            try {
              // Pass the body directly - cached_content is included if using explicit caching
              // extra_body (for things like google.thinking_config) is passed via body option
              stream = await client.chat.completions.create(bodyWithoutExtraBody, {
                signal: ac.signal,
                headers: sessionHeaders,
                ...(extra_body ? { body: extra_body } : {})
              }) as any
              break
            } catch (err: any) {
              // Don't retry non-rate-limit errors or abort errors
              if (!isRateLimitError(err) || err.name === 'AbortError' || cancelled) {
                throw err
              }
              // If this was the last attempt, throw
              if (attempt === MAX_RETRIES - 1) {
                throw err
              }
              // Calculate backoff and wait
              const backoffMs = calculateBackoff(attempt)
              console.log(`[${id}] Rate limited, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
              emit?.({
                type: 'rate_limit_wait',
                provider: id,
                model,
                rateLimitWait: {
                  attempt: attempt + 1,
                  waitMs: backoffMs,
                  reason: `Rate limited, retry ${attempt + 1}/${MAX_RETRIES}`
                }
              })
              await sleep(backoffMs)
              // Check if cancelled during sleep
              if (cancelled || ac.signal.aborted) break
            }
          }

          // Safety check - if stream wasn't assigned (shouldn't happen), skip this step
          if (!stream || cancelled) break

          // Try to extract rate limit headers from the response (if available)
          // OpenAI SDK exposes response metadata on the stream object for some providers
          try {
            const streamAny = stream as any
            const response = streamAny?.response || streamAny?._response
            if (response?.headers) {
              // Convert Headers object to plain object
              const headers: Record<string, string> = {}
              if (typeof response.headers.forEach === 'function') {
                response.headers.forEach((value: string, key: string) => {
                  headers[key.toLowerCase()] = value
                })
              } else if (typeof response.headers.entries === 'function') {
                for (const [key, value] of response.headers.entries()) {
                  headers[key.toLowerCase()] = value
                }
              }
              if (Object.keys(headers).length > 0) {
                rateLimitTracker.updateFromHeaders(id as any, model, headers)
              }
            }
          } catch {
            // Headers extraction is best-effort, don't fail the request
          }

          if (DEBUG) {
            console.log(`[${id}] Stream type:`, typeof stream, Object.prototype.toString.call(stream))
            console.log(`[${id}] Stream keys:`, Object.keys(stream as any))
          }

          let stepText = ''
          let stepReasoning = ''
          const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
          const seenToolIds = new Set<string>() // Track seen tool IDs to detect new parallel calls
          let stepUsage: any = null
          let finishReason: string | null = null

          try {
            for await (const chunk of stream) {
              if (cancelled || ac.signal.aborted) break

              const choice = chunk.choices?.[0]
              if (!choice) continue
              const delta = choice.delta as any

              // Capture finish reason
              if (choice.finish_reason) finishReason = choice.finish_reason

              if (DEBUG) {
                console.log(`[${id}] Chunk:`, JSON.stringify(chunk))
              }

              // Handle text content
              if (delta?.content) {
                let textToEmit = delta.content
                let reasoningToEmit = ''

                // Apply reasoning extraction if configured (e.g., <think> tags)
                if (reasoningExtractor) {
                  if (DEBUG) {
                    console.log(`[${id}] Before extraction - reasoningState:`, reasoningState)
                  }
                  const result = reasoningExtractor(delta.content, reasoningState)
                  textToEmit = result.text
                  reasoningToEmit = result.reasoning
                  reasoningState = result.state
                  if (DEBUG) {
                    console.log(`[${id}] After extraction - reasoningState:`, reasoningState)
                  }
                }

                if (reasoningToEmit) {
                  stepReasoning += reasoningToEmit
                  if (DEBUG) {
                    console.log(`[${id}] Emitting reasoning:`, reasoningToEmit.slice(0, 100))
                  }
                  emit?.({ type: 'reasoning', provider: id, model, reasoning: reasoningToEmit })
                }
                if (textToEmit) {
                  stepText += textToEmit
                  if (DEBUG) {
                    console.log(`[${id}] Emitting text chunk:`, textToEmit.slice(0, 100))
                  }
                  onTextChunk?.(textToEmit)
                }
              }

              // Capture reasoning from delta - different models use different fields
              // OpenRouter/some models use 'reasoning', GLM uses 'reasoning_content'
              const reasoningChunk = delta?.reasoning || delta?.reasoning_content
              if (reasoningChunk) {
                stepReasoning += reasoningChunk
                emit?.({ type: 'reasoning', provider: id, model, reasoning: reasoningChunk })
              }

              // Handle tool calls - use ID-based tracking for safety
              // Gemini sends each parallel tool call as a complete chunk with index=0 but different IDs
              // OpenAI streams partial data for each tool call with incrementing indices
              // OpenRouter may pass through Anthropic's format (tc.name, tc.input) instead of OpenAI's (tc.function.name, tc.function.arguments)
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (!tc.id) continue // Skip if no ID

                  // Handle both OpenAI format (tc.function.name/arguments) and Anthropic format (tc.name/input)
                  const tcName = tc.function?.name || tc.name || ''
                  // Anthropic uses tc.input (object), OpenAI uses tc.function.arguments (string)
                  const tcArgs = tc.function?.arguments || (tc.input ? JSON.stringify(tc.input) : '')

                  // Check if this is a new tool call (not seen before)
                  if (!seenToolIds.has(tc.id)) {
                    // New tool call - add it
                    seenToolIds.add(tc.id)
                    toolCalls.set(toolCalls.size, {
                      id: tc.id,
                      name: tcName,
                      arguments: tcArgs
                    })
                  } else {
                    // Existing tool call - append arguments (streaming delta)
                    // Find the entry with this ID and append arguments
                    for (const [, call] of toolCalls.entries()) {
                      if (call.id === tc.id) {
                        if (tcName) call.name = tcName
                        if (tcArgs) call.arguments += tcArgs
                        break
                      }
                    }
                  }
                }
              }

              // Capture Gemini 3 thought signature from extra_content
              const chunkAny = chunk as any
              if (chunkAny?.extra_content?.google?.thought_signature) {
                thoughtSignature = chunkAny.extra_content.google.thought_signature
              }

              // Process provider-specific chunk data via hook
              if (chunkProcessor) {
                const result = chunkProcessor(chunk, delta, { model, provider: id })
                if (result.reasoning) {
                  stepReasoning += result.reasoning
                  emit?.({ type: 'reasoning', provider: id, model, reasoning: result.reasoning })
                }
                if (result.thoughtSignature) {
                  thoughtSignature = result.thoughtSignature
                }
              }

              // Capture usage
              if (chunk.usage) {
                stepUsage = chunk.usage
                // Log cache stats for debugging (enabled via HF_DEBUG_CACHE=1)
                if (process.env.HF_DEBUG_CACHE === '1') {
                  const cached = chunk.usage.prompt_tokens_details?.cached_tokens || 0
                  const cacheDiscount = (chunk as any).cache_discount
                  const nativeCache = (chunk as any).native_tokens_prompt_cached
                  if (cached > 0 || cacheDiscount || nativeCache) {
                    console.log(`[${id}] Cache stats:`, {
                      prompt_tokens: chunk.usage.prompt_tokens,
                      cached_tokens: cached,
                      cache_discount: cacheDiscount,
                      native_cached: nativeCache,
                      full_usage: JSON.stringify(chunk.usage)
                    })
                  }
                }
                // Always log usage to file for cache debugging (HF_DEBUG_CACHE_FILE=1)
                // This captures EVERY step's usage, even when cached_tokens is 0
                if (process.env.HF_DEBUG_CACHE_FILE === '1') {
                  try {
                    const usageFile = '/tmp/hifide-usage-debug.json'
                    let usageData: any = { entries: [] }
                    try {
                      if (fs.existsSync(usageFile)) {
                        usageData = JSON.parse(fs.readFileSync(usageFile, 'utf8'))
                      }
                    } catch {}

                    const usage = chunk.usage as any
                    usageData.entries.push({
                      timestamp: new Date().toISOString(),
                      provider: id,
                      model,
                      stepCount,
                      // Raw usage object from API
                      rawUsage: chunk.usage,
                      // Extracted values - check ALL possible cache locations
                      extracted: {
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        // OpenAI format
                        cached_tokens_openai: usage.prompt_tokens_details?.cached_tokens || 0,
                        // OpenRouter/Anthropic format
                        native_cached: usage.native_tokens_prompt_cached || 0,
                        cache_read: usage.cache_read_input_tokens || 0,
                        // Gemini format at root (camelCase and snake_case)
                        cachedContentTokenCount: usage.cachedContentTokenCount || 0,
                        cached_content_token_count: usage.cached_content_token_count || 0,
                        // Gemini format nested in usage_metadata (both cases)
                        usage_metadata_camel: usage.usage_metadata?.cachedContentTokenCount || 0,
                        usage_metadata_snake: usage.usage_metadata?.cached_content_token_count || 0,
                        // Check for any key containing 'cache' (for discovery)
                        cacheRelatedKeys: Object.keys(usage).filter((k: string) =>
                          k.toLowerCase().includes('cache')
                        ),
                        // Also check usage_metadata keys if present
                        usageMetadataKeys: usage.usage_metadata ? Object.keys(usage.usage_metadata) : []
                      },
                      // Full chunk for analysis
                      fullChunk: chunk
                    })

                    if (usageData.entries.length > 50) usageData.entries = usageData.entries.slice(-50)
                    fs.writeFileSync(usageFile, JSON.stringify(usageData, null, 2))
                  } catch {}
                }
              }
            }
            if (DEBUG) {
              console.log(`[${id}] Stream loop ended normally. cancelled=${cancelled}, aborted=${ac.signal.aborted}`)
            }

            // Flush any remaining buffered reasoning (in case of incomplete tags)
            if (reasoningExtractor && reasoningState.insideTag && reasoningState.buffer) {
              stepReasoning += reasoningState.buffer
              emit?.({ type: 'reasoning', provider: id, model, reasoning: reasoningState.buffer })
            }
          } catch (err: any) {
            if (DEBUG) {
              console.log(`[${id}] Stream error:`, { name: err?.name, message: err?.message, status: err?.status })
              console.log(`[${id}] Error details:`, { message: err?.message, status: err?.status })
            }
            if (err?.name === 'AbortError' || ac.signal.aborted || cancelled) {
              break
            }
            throw err
          }

          // Emit token usage with explicit reasoning tokens when available
          if (stepUsage && onTokenUsage) {
            // Extract reasoning tokens from completion_tokens_details (OpenAI o1/o3 models)
            // or from dedicated reasoning_tokens field (some providers)
            const reasoningTokens =
              stepUsage.completion_tokens_details?.reasoning_tokens ||
              stepUsage.reasoning_tokens ||
              0

            // Extract cached tokens - check multiple possible locations:
            // - OpenAI: prompt_tokens_details.cached_tokens
            // - OpenRouter/Anthropic: native_tokens_prompt_cached or prompt_tokens_details.cached_tokens
            // - Some providers: cache_read_input_tokens
            // - Gemini native: cached_content_token_count (in usage_metadata, snake_case)
            // - Gemini variants: cachedContentTokenCount (camelCase) or at root
            const cachedTokens =
              stepUsage.prompt_tokens_details?.cached_tokens ||
              stepUsage.native_tokens_prompt_cached ||
              stepUsage.cache_read_input_tokens ||
              // Gemini formats (check both usage_metadata and root, both cases)
              stepUsage.usage_metadata?.cached_content_token_count ||
              stepUsage.usage_metadata?.cachedContentTokenCount ||
              stepUsage.cached_content_token_count ||
              stepUsage.cachedContentTokenCount ||
              0

            // Collect tool call arguments for output category tracking
            const toolCallArgs = Array.from(toolCalls.values())
              .filter(tc => tc.id && tc.name)
              .map(tc => tc.arguments)
              .join('')

            // Estimate token counts from output content (~4 chars per token)
            const estimateTokens = (s: string) => Math.ceil((s?.length || 0) / 4)

            onTokenUsage({
              inputTokens: stepUsage.prompt_tokens || 0,
              outputTokens: stepUsage.completion_tokens || 0,
              totalTokens: stepUsage.total_tokens || 0,
              cachedTokens,
              reasoningTokens,
              stepCount: stepCount,
              // Output token estimates for per-step category tracking
              stepOutput: {
                text: estimateTokens(stepText),
                reasoning: estimateTokens(stepReasoning),
                toolCallArgs: estimateTokens(toolCallArgs)
              }
            })
          }

          // Accumulate for turn
          if (stepText) turnText += (turnText ? '\n' : '') + stepText
          if (stepReasoning) turnReasoning += (turnReasoning ? '\n' : '') + stepReasoning

          // Filter valid tool calls
          const validToolCalls = Array.from(toolCalls.values()).filter(tc => tc.id && tc.name)

          if (DEBUG) {
            console.log(`[${id}] Step ${stepCount} complete:`, {
              textLength: stepText.length,
              rawToolCalls: toolCalls.size,
              validToolCalls: validToolCalls.length,
              finishReason,
              toolCallsData: validToolCalls
            })
          }

          // No tool calls = done (we've reached a final response)
          // Note: Gemini returns finish_reason='stop' even with tool calls,
          // so we only check finish_reason when there are no tool calls.
          if (validToolCalls.length === 0) {
            break
          }

          // Add assistant message to local conversation
          // Note: Gemini rejects both content: null AND content: "" (empty string)
          // Must omit content entirely when there's no text
          const assistantMsg: any = { role: 'assistant' }
          if (stepText) {
            assistantMsg.content = stepText
          }
          assistantMsg.tool_calls = validToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments }
          }))

          // Include reasoning_content for GLM and similar models with interleaved thinking
          if (stepReasoning) {
            assistantMsg.reasoning_content = stepReasoning
          }

          // Add thought signature for Gemini 3 models (in extra_content format)
          if (thoughtSignature) {
            assistantMsg.extra_content = {
              google: { thought_signature: thoughtSignature }
            }
          }

          conversationMessages.push(assistantMsg)

          // Execute tool calls and add results
          for (const tc of validToolCalls) {
            if (cancelled) break
            const safeName = tc.name
            const originalName = nameMap.get(safeName) || safeName
            const tool = toolMap.get(safeName)

            let args: any = {}
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {}
            } catch {
              args = {}
            }

            onToolStart?.({ callId: tc.id, name: originalName, arguments: args })

            // Helper to create tool result message
            // Gemini's OpenAI-compatible endpoint may reject role: 'tool' - use 'user' as workaround
            // See: https://discuss.ai.google.dev/t/returning-tool-function-results-over-openai-api/55933
            const isGemini = id === 'gemini' || id.startsWith('gemini')
            const createToolResult = (callId: string, content: string): any => {
              if (isGemini) {
                // Gemini workaround: use 'user' role with tool result context
                return { role: 'user', content: `[Tool result for ${originalName}]: ${content}` }
              }
              return { role: 'tool', tool_call_id: callId, content }
            }

            if (!tool) {
              const error = `Tool not found: ${originalName}`
              onToolError?.({ callId: tc.id, name: originalName, error })
              conversationMessages.push(createToolResult(tc.id, JSON.stringify({ error })))
              continue
            }

            try {
              const raw = await tool.run(args, toolMeta)

              // Handle toModelResult if present
              let result = raw
              const toModel = (tool as any).toModelResult
              if (typeof toModel === 'function') {
                try {
                  const res = await toModel(raw)
                  if (res?.ui && res?.previewKey) {
                    UiPayloadCache.put(res.previewKey, res.ui)
                  }
                  result = res?.minimal ?? raw
                } catch {}
              }

              onToolEnd?.({ callId: tc.id, name: originalName, result })
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
              conversationMessages.push(createToolResult(tc.id, resultStr))

            } catch (err: any) {
              const error = err?.message || String(err)
              onToolError?.({ callId: tc.id, name: originalName, error })
              conversationMessages.push(createToolResult(tc.id, JSON.stringify({ error })))
            }
          }
        }

        // Report consolidated step (text + reasoning only)
        // Tool calls/results are intentionally NOT passed - they are handled
        // within this provider's agentic loop and should not be persisted to
        // session history (which would cause context explosion on next turn)
        onStep?.({
          text: turnText,
          reasoning: turnReasoning || undefined
        })

        onStreamDone?.()
      }

      // Start the loop and await it to ensure streaming completes before returning
      // This prevents race conditions where the caller thinks the request is done
      // but streaming is still happening in the background
      const loopPromise = runLoop().catch((err: any) => {
        if (err?.name !== 'AbortError' && !ac.signal.aborted) {
          console.error(`[${id}] Stream error:`, err)
          console.error(`[${id}] Error details:`, {
            message: err?.message,
            status: err?.status,
            code: err?.code,
            type: err?.type,
            error: err?.error
          })
          onStreamError?.(err?.message || String(err))
        }
      })

      return {
        cancel: () => {
          cancelled = true
          try { ac.abort() } catch {}
        },
        // Internal promise for testing/debugging - allows callers to await completion if needed
        _loopPromise: loopPromise
      }
    }
  }
}

