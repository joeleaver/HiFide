/**
 * Core OpenAI-compatible provider factory.
 * 
 * This module provides a factory function to create provider adapters for any
 * OpenAI-compatible API. The OpenRouter provider is the reference implementation,
 * and other providers (Fireworks, xAI, OpenAI direct, etc.) are thin wrappers.
 */
import OpenAI from 'openai'
import { UiPayloadCache } from '../../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../../src/store/utils/constants'
import type { ProviderAdapter, StreamHandle, AgentTool } from '../../providers/provider'

// Re-export types for convenience
export type { ProviderAdapter, StreamHandle, AgentTool }

const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

// Rate limiting constants
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
}

export interface RequestContext {
  model: string
  hasTools: boolean
  temperature?: number
  reasoningEffort?: string
  includeThoughts?: boolean
  thinkingBudget?: number
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
 * - Removes additionalProperties which some providers don't support
 * - Adds placeholder property for parameterless functions (some providers require non-empty properties)
 */
function cleanParameters(params: any): any {
  const placeholderProp = { _: { type: 'string', description: 'Not used' } }

  if (!params || typeof params !== 'object') {
    return { type: 'object', properties: placeholderProp }
  }

  // Deep clone to avoid mutating original
  const cleaned = JSON.parse(JSON.stringify(params))

  // Recursively clean schema objects
  function cleanSchema(obj: any): void {
    if (!obj || typeof obj !== 'object') return

    // Remove additionalProperties
    delete obj.additionalProperties

    // Remove validation keywords that some providers don't support
    delete obj.minLength
    delete obj.maxLength
    delete obj.minimum
    delete obj.maximum
    delete obj.pattern
    delete obj.format
    delete obj.minItems
    delete obj.maxItems
    delete obj.uniqueItems

    // Process nested properties
    if (obj.properties && typeof obj.properties === 'object') {
      for (const key of Object.keys(obj.properties)) {
        cleanSchema(obj.properties[key])
      }
    }

    // Process array items
    if (obj.items) {
      cleanSchema(obj.items)
    }
  }

  cleanSchema(cleaned)

  // Ensure non-empty properties
  if (!cleaned.properties || Object.keys(cleaned.properties).length === 0) {
    cleaned.properties = placeholderProp
  }

  // Ensure required array exists (some providers require it)
  if (!Array.isArray(cleaned.required)) {
    cleaned.required = []
  }

  // GLM-4 quirk: tools with no required parameters don't get called properly.
  // Add a dummy required parameter if needed.
  if (cleaned.required.length === 0) {
    cleaned.properties._confirm = { type: 'boolean', description: 'Set to true to execute', default: true }
    cleaned.required = ['_confirm']
  }

  return cleaned
}

/**
 * Build tools in OpenAI function calling format.
 */
function buildOpenAITools(tools: AgentTool[] | undefined): { 
  openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined
  toolMap: Map<string, AgentTool>
  nameMap: Map<string, string>
} {
  if (!tools?.length) {
    return { openaiTools: undefined, toolMap: new Map(), nameMap: new Map() }
  }
  
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
  const toolMap = new Map<string, AgentTool>()
  const nameMap = new Map<string, string>() // safe -> original
  
  for (const t of tools) {
    if (!t?.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    nameMap.set(safe, t.name)
    toolMap.set(safe, t)
    
    openaiTools.push({
      type: 'function',
      function: {
        name: safe,
        description: t.description || '',
        parameters: cleanParameters(t.parameters),
        strict: false
      }
    })
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
      result.push({ role: 'assistant', content: convertMessageContent(msg.content) })
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
  const { id, baseURL, defaultHeaders, requestModifier, chunkProcessor, reasoningExtractor } = config

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
      thinkingBudget
    }): Promise<StreamHandle> {
      const ac = new AbortController()

      // Create OpenAI client with provider-specific config
      const client = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders
      })

      // Build tools
      const { openaiTools, toolMap, nameMap } = buildOpenAITools(tools)
      const hasTools = !!openaiTools?.length

      // Convert messages - this array will be mutated during the agentic loop
      let conversationMessages = toOpenAIMessages(messages || [])

      // Add system message if provided
      // Handle both Anthropic format (blocks array) and OpenAI format (string)
      if (system) {
        if (Array.isArray(system)) {
          // Anthropic format - blocks array
          conversationMessages.unshift({ role: 'system', content: system })
        } else if (typeof system === 'string') {
          // OpenAI/Fireworks format - string
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

          // Build request body fresh each iteration (like OpenRouter)
          let requestBody: any = {
            model,
            messages: conversationMessages,
            tools: hasTools ? openaiTools : undefined,
            tool_choice: hasTools ? 'auto' : undefined,
            temperature: typeof temperature === 'number' ? temperature : undefined,
            stream: true
          }

          // Add responseSchema if provided (for structured outputs)
          if (responseSchema) {
            requestBody.response_format = {
              type: 'json_schema',
              json_schema: responseSchema
            }
          }

          // Apply provider-specific modifications
          if (requestModifier) {
            requestBody = requestModifier(requestBody, {
              model,
              hasTools,
              temperature,
              reasoningEffort,
              includeThoughts,
              thinkingBudget
            })
          }

          if (DEBUG) {
            console.log(`[${id}] Step ${stepCount}, messages: ${conversationMessages.length}`)
            // Log all messages to see what we're sending
            console.log(`[${id}] Messages:`, JSON.stringify(conversationMessages, null, 2))
            // Log the full request body
            console.log(`[${id}] Full request body:`, JSON.stringify(requestBody, null, 2))
            if (stepCount === 1 && hasTools) {
              console.log(`[${id}] Tool count: ${openaiTools!.length}`)
            }
          }

          // Make API call with exponential backoff for rate limiting
          let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | undefined
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            if (cancelled || ac.signal.aborted) break
            try {
              stream = await client.chat.completions.create(requestBody, { signal: ac.signal }) as any
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
            }
          }

          // Safety check - if stream wasn't assigned (shouldn't happen), skip this step
          if (!stream || cancelled) break

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
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (!tc.id) continue // Skip if no ID

                  // Check if this is a new tool call (not seen before)
                  if (!seenToolIds.has(tc.id)) {
                    // New tool call - add it
                    seenToolIds.add(tc.id)
                    toolCalls.set(toolCalls.size, {
                      id: tc.id,
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || ''
                    })
                  } else {
                    // Existing tool call - append arguments (streaming delta)
                    // Find the entry with this ID and append arguments
                    for (const [, call] of toolCalls.entries()) {
                      if (call.id === tc.id) {
                        if (tc.function?.name) call.name = tc.function.name
                        if (tc.function?.arguments) call.arguments += tc.function.arguments
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
              }
            }
            if (DEBUG) {
              console.log(`[${id}] Stream loop ended normally. cancelled=${cancelled}, aborted=${ac.signal.aborted}`)
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

          // Emit token usage
          if (stepUsage && onTokenUsage) {
            onTokenUsage({
              inputTokens: stepUsage.prompt_tokens || 0,
              outputTokens: stepUsage.completion_tokens || 0,
              totalTokens: stepUsage.total_tokens || 0,
              cachedTokens: stepUsage.prompt_tokens_details?.cached_tokens || 0,
              stepCount: stepCount
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
            const isGemini = id === 'gemini-openai' || id.startsWith('gemini')
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

