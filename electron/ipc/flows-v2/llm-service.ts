/**
 * LLM Service - Unified abstraction layer for all LLM provider interactions
 *
 * This service handles:
 * - Provider selection and API key retrieval
 * - Message history management (scheduler owns the conversation state)
 * - Tool execution coordination
 * - Event emission (chunks, tokens, tool lifecycle)
 * - Error handling
 *
 * Benefits:
 * - Nodes are provider-agnostic (no provider-specific logic in nodes)
 * - Event handling is centralized (no duplication)
 * - Conversation management is unified (scheduler owns all state)
 * - Providers are stateless (just accept messages, stream responses)
 * - Easy to test (mock the service, not individual providers)
 * - Provider switching is built-in
 * - Easy to implement context windowing (scheduler controls what messages are sent)
 */

import type { MainFlowContext } from './types'
import type { FlowAPI } from './flow-api'
import type { AgentTool, ChatMessage } from '../../providers/provider'
import { providers } from '../../core/state'
import { getProviderKey } from '../../core/state'
import { createCallbackEventEmitters } from './execution-events'
import { rateLimitTracker } from '../../providers/rate-limit-tracker'
import { parseRateLimitError, sleep, withRetries } from '../../providers/retry'

// Lightweight token estimators used as a last-resort when a stream is cancelled
// and the provider does not return final usage. This avoids adding heavyweight
// tokenizer deps and keeps cancellation graceful with best-effort stats.
function estimateTokensFromText(s: string | undefined | null): number {
  if (!s) return 0
  // Rough heuristic: ~4 chars per token for LLM English text
  const asciiWeightedLen = String(s).replace(/[^\x00-\x7F]/g, 'xx').length
  return Math.ceil(asciiWeightedLen / 4)
}

function estimateInputTokens(provider: string, formattedMessages: any): number {
  try {
    if (provider === 'anthropic') {
      const systemBlocks = formattedMessages?.system as Array<{ type: string; text?: string }> | undefined
      const msgArr = formattedMessages?.messages as Array<{ content: string }> | undefined
      let total = 0
      if (Array.isArray(systemBlocks)) {
        for (const b of systemBlocks) total += estimateTokensFromText((b as any)?.text)
      }
      if (Array.isArray(msgArr)) {
        for (const m of msgArr) total += estimateTokensFromText(m?.content)
      }
      return total
    }
    if (provider === 'gemini') {
      const sys = formattedMessages?.systemInstruction as string | undefined
      const contents = formattedMessages?.contents as Array<{ parts: Array<{ text: string }> }> | undefined
      let total = estimateTokensFromText(sys)
      if (Array.isArray(contents)) {
        for (const c of contents) {
          if (Array.isArray(c?.parts)) {
            for (const p of c.parts) total += estimateTokensFromText(p?.text)
          }
        }
      }
      return total
    }
    // Default/OpenAI-style ChatMessage[]
    const arr = formattedMessages as Array<{ content: string }> | undefined
    let total = 0
    if (Array.isArray(arr)) {
      for (const m of arr) total += estimateTokensFromText(m?.content)
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Wrap tools with per-request policy to enforce low-discovery, edit-first behavior.
 * - Limit workspace.search calls (discovery lock)
 * - Force compact results and searchOnce behavior
 * - Dedupe fs.read_lines calls and cap per-file reads
 */
function wrapToolsWithPolicy(tools: AgentTool[], policy?: {
  maxWorkspaceSearch?: number
  dedupeReadLines?: boolean
  maxReadLinesPerFile?: number
  dedupeReadFile?: boolean
  maxReadFilePerFile?: number
  forceSearchOnce?: boolean
}): AgentTool[] {
  const wsSearchSeen = new Map<string, any>()
  const readLinesSeen = new Set<string>()
  const readLinesPerFile = new Map<string, number>()
  const readFileSeen = new Set<string>()
  const readFilePerFile = new Map<string, number>()

  const parseHandle = (h?: string): { p?: string; s?: number; e?: number } | null => {
    if (!h) return null
    try { return JSON.parse(Buffer.from(String(h), 'base64').toString('utf-8')) } catch { return null }
  }

  return (tools || []).map((t) => {
    if (!t || !t.name || typeof t.run !== 'function') return t

    if (t.name === 'workspace.search') {
      const orig = t.run.bind(t)
      const wrapped: AgentTool = {
        ...t,
        run: async (input: any, meta?: any) => {
          const args = { ...(input || {}) }
          // Request-level dedupe: identical args → return cached result
          const key = JSON.stringify(args)
          if (wsSearchSeen.has(key)) {
            return wsSearchSeen.get(key)
          }
          const out = await orig(args, meta)
          try { wsSearchSeen.set(key, out) } catch {}
          return out
        }
      }
      return wrapped
    }

    if (t.name === 'fs.read_lines') {
      const orig = t.run.bind(t)
      const wrapped: AgentTool = {
        ...t,
        run: async (input: any, meta?: any) => {
          const args = input || {}
          const h = parseHandle(args.handle)
          const rel = (args.path as string) || (h && h.p) || ''
          // Build a signature key that captures the specific range/window requested
          const sigKey = JSON.stringify({
            tool: 'fs.read_lines',
            path: rel,
            handle: !!args.handle,
            mode: args.mode || 'range',
            start: args.startLine,
            end: args.endLine,
            focus: args.focusLine,
            window: args.window,
            before: args.beforeLines,
            after: args.afterLines
          })

          // Cap applies to identical range signatures, not the entire file
          if (typeof policy?.maxReadLinesPerFile === 'number') {
            const c = readLinesPerFile.get(sigKey) || 0
            if (c >= policy.maxReadLinesPerFile) {
              return { ok: false, error: 'read_locked: read limit reached for this range' }
            }
          }

          // Dedupe identical reads
          if (policy?.dedupeReadLines) {
            const key = JSON.stringify({ tool: 'fs.read_lines', path: rel, handle: !!args.handle, mode: args.mode || 'range', start: args.startLine, end: args.endLine, focus: args.focusLine, window: args.window, before: args.beforeLines, after: args.afterLines })
            if (readLinesSeen.has(key)) {
              return { ok: true, cached: true }
            }
            readLinesSeen.add(key)
          }

          const out = await orig(args, meta)

          if (out && out.ok && typeof policy?.maxReadLinesPerFile === 'number') {
            const c = readLinesPerFile.get(sigKey) || 0
            readLinesPerFile.set(sigKey, c + 1)
          }
          return out
        }
      }
      return wrapped
    }

    if (t.name === 'fs.read_file') {
      const orig = t.run.bind(t)
      const wrapped: AgentTool = {
        ...t,
        run: async (input: any, meta?: any) => {
          const args = input || {}
          const rel = (args.path as string) || ''

          // Per-file cap
          if (typeof policy?.maxReadFilePerFile === 'number' && rel) {
            const c = readFilePerFile.get(rel) || 0
            if (c >= policy.maxReadFilePerFile) {
              return { ok: false, error: 'read_locked: fs.read_file per-file read limit reached' }
            }
          }

          // Dedupe identical reads
          if (policy?.dedupeReadFile) {
            const key = JSON.stringify({ tool: 'fs.read_file', path: rel })
            if (readFileSeen.has(key)) {
              return { ok: true, cached: true }
            }
            readFileSeen.add(key)
          }

          const out = await orig(args, meta)

          if (out && out.ok && typeof policy?.maxReadFilePerFile === 'number' && rel) {
            const c = readFilePerFile.get(rel) || 0
            readFilePerFile.set(rel, c + 1)
          }
          return out
        }
      }
      return wrapped
    }

    return t
  })
}


/**
 * Request to the LLM service
 */
export interface LLMServiceRequest {
  /** User message to send */
  message: string

  /** Optional tools for agent mode */
  tools?: AgentTool[]

  /** Main flow context (contains provider, model, history, etc.) */
  context: MainFlowContext

  /** FlowAPI instance for emitting execution events */
  flowAPI: FlowAPI

  /** Optional JSON schema for structured output */
  responseSchema?: any

  /** Override provider (for nodes that use their own provider, like intentRouter) */
  overrideProvider?: string

  /** Override model (for nodes that use their own model, like intentRouter) */
  overrideModel?: string

  /** Skip adding message to context history (for stateless calls like intentRouter) */
  skipHistory?: boolean
}

/**
 * Response from the LLM service
 */
export interface LLMServiceResponse {
  /** Assistant's response text */
  text: string

  /** Updated context with new messages */
  updatedContext: MainFlowContext

  /** Error message if request failed */
  error?: string
}

/**
 * Format messages for OpenAI
 * OpenAI accepts our ChatMessage format directly (but we strip metadata)
 */
function formatMessagesForOpenAI(context: MainFlowContext): ChatMessage[] {
  const messages: ChatMessage[] = []

  // Add system instructions if present
  if (context.systemInstructions) {
    messages.push({ role: 'system', content: context.systemInstructions })
  }

  // Add all message history (strip metadata - OpenAI doesn't accept extra fields)
  messages.push(...context.messageHistory.map(m => ({
    role: m.role,
    content: m.content
  })))

  return messages
}

/**
 * Format messages for Anthropic
 * Anthropic separates system messages and uses prompt caching
 */
function formatMessagesForAnthropic(context: MainFlowContext): {
  system: any
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  // Extract system instructions
  const systemText = context.systemInstructions || ''

  // Use prompt caching for system prompt when available
  const system: any = systemText
    ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    : undefined

  // Convert message history (exclude system messages, only user/assistant)
  const messages = context.messageHistory
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

  return { system, messages }
}

/**
 * Format messages for Gemini
 * Gemini uses 'model' instead of 'assistant' and a different structure
 */
function formatMessagesForGemini(context: MainFlowContext): {
  systemInstruction: string
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
} {
  // Extract system instructions
  const systemInstruction = context.systemInstructions || ''

  // Convert message history to Gemini format
  const contents = context.messageHistory
    .filter(m => m.role !== 'system')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }))

  return { systemInstruction, contents }
}

/**
 * LLM Service - main service class
 * Now stateless - all conversation state is managed by the scheduler
 */
class LLMService {
  constructor() {
    // No state needed - providers are stateless
  }

  /**
   * Send a message to the LLM and get a response
   *
   * This is the main entry point for all LLM interactions.
   * It handles provider selection, API keys, context management,
   * event emission, and error handling.
   */
  async chat(request: LLMServiceRequest): Promise<LLMServiceResponse> {
    const { message, tools, context, flowAPI, responseSchema, overrideProvider, overrideModel, skipHistory } = request

    // Use override provider/model if specified (for nodes like intentRouter)
    const provider = overrideProvider || context.provider
    const model = overrideModel || context.model

    // 1. Get provider adapter
    const providerAdapter = providers[provider]
    if (!providerAdapter) {
      return {
        text: '',
        updatedContext: context,
        error: `Unknown provider: ${provider}`
      }
    }

    // 2. Get API key
    const apiKey = await getProviderKey(provider)
    if (!apiKey) {
      return {
        text: '',
        updatedContext: context,
        error: `Missing API key for provider: ${provider}`
      }
    }

    // 3. Clone context and optionally add user message
    let updatedContext: MainFlowContext
    if (skipHistory) {
      // For stateless calls (like intentRouter), don't modify history
      updatedContext = context
    } else {
      // Normal case: add user message to history
      updatedContext = {
        ...context,
        messageHistory: [...context.messageHistory, { role: 'user', content: message }]
      }
    }

    // 4. Format messages for the specific provider
    // llm-service is responsible for converting MainFlowContext to provider-specific format
    let formattedMessages: any

    if (skipHistory) {
      // For stateless calls (like intentRouter), just send the message directly
      // Format it appropriately for each provider
      if (provider === 'anthropic') {
        formattedMessages = {
          system: undefined,
          messages: [{ role: 'user' as const, content: message }]
        }
      } else if (provider === 'gemini') {
        formattedMessages = {
          systemInstruction: '',
          contents: [{ role: 'user', parts: [{ text: message }] }]
        }
      } else {
        // OpenAI and others
        formattedMessages = [{ role: 'user' as const, content: message }]
      }
    } else {
      // Normal case: format full conversation history for the provider
      console.log(`[LLMService] Formatting messages for ${provider}:`, {
        contextMessageHistoryLength: updatedContext.messageHistory.length,
        systemInstructions: updatedContext.systemInstructions?.substring(0, 50) + '...'
      })

      if (provider === 'anthropic') {
        formattedMessages = formatMessagesForAnthropic(updatedContext)
        console.log(`[LLMService] Anthropic formatted:`, {
          systemLength: formattedMessages.system?.length || 0,
          messagesLength: formattedMessages.messages?.length || 0,
          messages: formattedMessages.messages
        })
      } else if (provider === 'gemini') {
        formattedMessages = formatMessagesForGemini(updatedContext)
        console.log(`[LLMService] Gemini formatted:`, {
          systemInstructionLength: formattedMessages.systemInstruction?.length || 0,
          contentsLength: formattedMessages.contents?.length || 0,
          contents: formattedMessages.contents
        })
      } else {
        // OpenAI and others
        formattedMessages = formatMessagesForOpenAI(updatedContext)
        console.log(`[LLMService] OpenAI formatted:`, {
          messagesLength: formattedMessages.length,
          messages: formattedMessages
        })
      }
    }

    // 5. Set up event handlers using the new execution event system
    // Convert execution events to legacy callbacks for now (migration adapter)
    // Wrap emitter to suppress chunk events if skipHistory is true
    const emit = skipHistory
      ? (event: any) => {
          // Suppress chunk events for stateless calls (like intentRouter)
          if (event.type !== 'chunk') {
            flowAPI.emitExecutionEvent(event)
          }
        }
      : flowAPI.emitExecutionEvent

    const eventHandlers = createCallbackEventEmitters(emit, provider, model)

    // Track latest usage (if provider reports it) and maintain a best-effort fallback
    let lastReportedUsage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number } | null = null
    let usageEmitted = false
    const emitUsage = eventHandlers.onTokenUsage
    const onTokenUsageWrapped = (u: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number }) => {
      lastReportedUsage = u
      usageEmitted = true
      emitUsage(u)
    }

    // Pre-compute an approximate input token count as a fallback
    const approxInputTokens = estimateInputTokens(provider, formattedMessages)

    // 6. Call provider with formatted messages
    console.log(`[LLMService] Starting stream:`, {
      provider,
      model,
      hasTools: !!tools && tools.length > 0,
      toolCount: tools?.length || 0,
      messageHistoryLength: formattedMessages.messages?.length || 0,
      toolNames: tools?.map(t => t.name) || []
    })

    let response = ''

    try {
      // PROACTIVE RATE LIMIT CHECK - Wait before making request if needed
      const waitMs = await rateLimitTracker.checkAndWait(provider as any, model)
      if (waitMs > 0) {
        console.log(`[LLMService] Proactive rate limit wait: ${waitMs}ms for ${provider}/${model}`)

        // Emit event to UI
        flowAPI.emitExecutionEvent({
          type: 'rate_limit_wait',
          provider,
          model,
          rateLimitWait: {
            attempt: 0, // 0 = proactive wait (not a retry)
            waitMs,
            reason: 'Proactive rate limit enforcement'
          }
        })

        await sleep(waitMs)
      }

      // Record this request (optimistic tracking)
      rateLimitTracker.recordRequest(provider as any, model)

      await new Promise<void>(async (resolve, reject) => {
        let streamHandle: { cancel: () => void } | null = null
        const onAbort = () => {
          try { streamHandle?.cancel() } catch {}
          try {
            // Best-effort usage on cancel: prefer provider-reported usage; otherwise estimate
            if (!usageEmitted && lastReportedUsage) {
              usageEmitted = true
              emitUsage(lastReportedUsage)
            } else if (!usageEmitted) {
              const approxOutput = estimateTokensFromText(response)
              usageEmitted = true
              emitUsage({ inputTokens: approxInputTokens, outputTokens: approxOutput, totalTokens: approxInputTokens + approxOutput })
            }
          } catch {}
          reject(new Error('Flow cancelled'))
        }
        try {
          // If already aborted before starting, bail out
          if (flowAPI.signal?.aborted) {
            onAbort()
            return
          }
          flowAPI.signal?.addEventListener('abort', onAbort, { once: true } as any)

          // Base stream options (common to all providers)
          const baseStreamOpts = {
            apiKey,
            model,
            // Sampling + reasoning controls (forwarded to providers when supported)
            ...(typeof updatedContext?.temperature === 'number' ? { temperature: updatedContext.temperature } : {}),
            ...(updatedContext?.reasoningEffort ? { reasoningEffort: updatedContext.reasoningEffort } : {}),
            // Callbacks that providers call - these are wrapped to emit ExecutionEvents
            onChunk: (text: string) => {
              // Skip duplicate final chunks (some providers send the full response as a final chunk)
              if (text === response) {
                return
              }
              response += text
              eventHandlers.onChunk(text)
            },
            onDone: () => {
              console.log(`[LLMService] Stream completed:`, {
                provider,
                model,
                responseLength: response.length
              })
              try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch {}
              resolve()
            },
            onError: (error: string) => {
              console.error(`[LLMService] Stream error:`, error)
              try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch {}
              reject(new Error(error))
            },
            onTokenUsage: onTokenUsageWrapped
          }

          // Provider-specific options
          let streamOpts: any
          if (provider === 'anthropic') {
            streamOpts = {
              ...baseStreamOpts,
              system: formattedMessages.system,
              messages: formattedMessages.messages
            }
          } else if (provider === 'gemini') {
            streamOpts = {
              ...baseStreamOpts,
              systemInstruction: formattedMessages.systemInstruction,
              contents: formattedMessages.contents
            }
          } else {
            // OpenAI and others use standard ChatMessage[] format
            streamOpts = {
              ...baseStreamOpts,
              messages: formattedMessages
            }
          }

          // Use agentStream if:
          // 1. We have tools to use, OR
          // 2. We have a responseSchema (structured output), OR
          // 3. Both
          const needsAgentStream = (tools && tools.length > 0) || responseSchema

          // Wrap provider call with retry logic
          await withRetries(
            async () => {
              if (needsAgentStream && providerAdapter.agentStream) {
                // Use agentStream with tools and/or structured output
                console.log('[LLMService] Calling agentStream with toolMeta:', { requestId: context.contextId, contextId: context.contextId })
                const policyTools = (tools && tools.length)
                  ? wrapToolsWithPolicy(tools, {
                      // Disable dedupe for fs.read_lines/fs.read_file to ensure RAW text is returned (no cached JSON stubs)
                      dedupeReadLines: false,
                      maxReadLinesPerFile: 1,
                      dedupeReadFile: false,
                      maxReadFilePerFile: 1,
                    })
                  : []
                streamHandle = await providerAdapter.agentStream({
                  ...streamOpts,
                  tools: policyTools,
                  responseSchema,
                  toolMeta: { requestId: context.contextId }, // Use contextId as requestId
                  onToolStart: eventHandlers.onToolStart,
                  onToolEnd: eventHandlers.onToolEnd,
                  onToolError: eventHandlers.onToolError
                })
              } else {
                // Use regular chatStream (no tools, no structured output)
                streamHandle = await providerAdapter.chatStream(streamOpts)
              }
            },
            {
              max: 3,
              maxWaitMs: 60000,
              onRateLimitWait: ({ attempt, waitMs, reason }) => {
                console.log(`[LLMService] Rate limit retry wait: ${waitMs}ms (attempt ${attempt})`)

                // Emit event to UI
                flowAPI.emitExecutionEvent({
                  type: 'rate_limit_wait',
                  provider,
                  model,
                  rateLimitWait: {
                    attempt,
                    waitMs,
                    reason
                  }
                })
              }
            }
          )
        } catch (e: any) {
          // Check if this was a rate limit error and update tracker
          const rateLimitInfo = parseRateLimitError(e)
          if (rateLimitInfo.isRateLimit) {
            console.log(`[LLMService] Learning from rate limit error:`, rateLimitInfo)
            rateLimitTracker.updateFromError(provider as any, model, e, rateLimitInfo)
          }

          try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch {}
          reject(e)
        }
      })
    } catch (e: any) {
      const errorMessage = e.message || String(e)
      console.error(`[LLMService] Error during chat:`, errorMessage)

      // Treat cancellations/terminations as non-errors for UI event emission
      const isCancellation = /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(errorMessage)
      if (!isCancellation) {
        // Send error event to UI only for real errors
        eventHandlers.onError(errorMessage)
      } else {
        console.log('[LLMService] Cancellation detected, suppressing error event')
      }

      return {
        text: '',
        updatedContext,
        error: errorMessage
      }
    }

    // 7. Add assistant response to context (unless skipHistory)
    let finalContext: MainFlowContext
    if (skipHistory) {
      // For stateless calls, don't modify context
      finalContext = updatedContext
    } else {
      // Normal case: add assistant response to history
      finalContext = {
        ...updatedContext,
        messageHistory: [...updatedContext.messageHistory, { role: 'assistant', content: response }]
      }

      console.log(`[LLMService] Added assistant response to context:`, {
        provider,
        model,
        messageHistoryLength: finalContext.messageHistory.length,
        lastMessage: finalContext.messageHistory[finalContext.messageHistory.length - 1]
      })
    }

    console.log(`[LLMService] Returning from chat():`, {
      provider,
      model,
      responseLength: response.length,
      messageHistoryLength: finalContext.messageHistory.length
    })

    return {
      text: response,
      updatedContext: finalContext
    }
  }
}

// Singleton instance
export const llmService = new LLMService()

