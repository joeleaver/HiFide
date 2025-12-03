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
import type { ContextManager } from './contextManager'
import type { AgentTool, ChatMessage, ProviderAdapter } from '../providers/provider'

import { getProviderKey, providers } from '../core/state'
import { createCallbackEventEmitters } from './execution-events'
import { rateLimitTracker } from '../providers/rate-limit-tracker'
import { parseRateLimitError, sleep, withRetries } from '../providers/retry'

import { DEFAULT_PRICING } from '../data/defaultPricing'
import { encoding_for_model, get_encoding } from '@dqbd/tiktoken'

import { UiPayloadCache } from '../core/uiPayloadCache'

const DEBUG_USAGE = false

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

// --- Logging helpers (sanitized payload preview) ---
function previewText(val: any, max = 400): string {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return ''
  }
}

function buildLoggablePayload(provider: string, streamOpts: any, extras?: { responseSchema?: any; tools?: AgentTool[] }) {
  const { apiKey: _omitApiKey, messages, system, systemInstruction, contents, ...rest } = (streamOpts || {})
  const out: any = { provider, ...rest }

  if (provider === 'anthropic') {
    out.systemBlocks = Array.isArray(system) ? system.length : 0
    out.messages = Array.isArray(messages)
      ? messages.map((m: any, i: number) => ({ idx: i, role: m?.role, preview: previewText(m?.content, 200) }))
      : undefined
  } else if (provider === 'gemini') {
    out.systemInstructionPreview = previewText(systemInstruction, 200)
    out.contents = Array.isArray(contents)
      ? contents.map((c: any, i: number) => ({ idx: i, parts: Array.isArray(c?.parts) ? c.parts.length : 0, preview: previewText((c?.parts || []).map((p: any) => p?.text).join(' '), 200) }))
      : undefined
  } else {
    // OpenAI and default ChatMessage[]
    if (typeof system === 'string' && system) {
      out.systemPreview = previewText(system, 200)
    }
    out.messages = Array.isArray(messages)
      ? messages.map((m: any, i: number) => ({ idx: i, role: m?.role, preview: previewText(m?.content, 200) }))
      : undefined
  }

  if (extras?.responseSchema) {
    out.responseSchema = {
      name: extras.responseSchema.name,
      strict: !!extras.responseSchema.strict,
      keys: Object.keys(extras.responseSchema.schema?.properties || {})
    }
  }
  if (extras?.tools) {
    out.tools = (extras.tools || []).map((t) => t?.name).filter(Boolean)
  }
  return out
}

function logLLMRequestPayload(args: {
  provider: string
  model?: string
  streamType: 'chat' | 'agent'
  streamOpts: any
  responseSchema?: any
  tools?: AgentTool[]
}) {
  try {
    const payload = buildLoggablePayload(args.provider, args.streamOpts, { responseSchema: args.responseSchema, tools: args.tools })
    console.log('[LLMRequest] Payload', {
      provider: args.provider,
      model: args.model,
      streamType: args.streamType,
      payload
    })
  } catch { }
}

/**
// --- Logging helpers (sanitized payload preview) ---
function previewText(val: any, max = 400): string {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return ''
  }
}

function buildLoggablePayload(provider: string, streamOpts: any, extras?: { responseSchema?: any; tools?: AgentTool[] }) {
  const { apiKey: _omitApiKey, messages, system, systemInstruction, contents, instructions, ...rest } = (streamOpts || {})
  const out: any = { provider, ...rest }

  if (provider === 'anthropic') {
    out.systemBlocks = Array.isArray(system) ? system.length : 0
    out.messages = Array.isArray(messages)
      ? messages.map((m: any, i: number) => ({ idx: i, role: m?.role, preview: previewText(m?.content, 200) }))
      : undefined
  } else if (provider === 'gemini') {
    out.systemInstructionPreview = previewText(systemInstruction, 200)
    out.contents = Array.isArray(contents)
      ? contents.map((c: any, i: number) => ({ idx: i, parts: Array.isArray(c?.parts) ? c.parts.length : 0, preview: previewText((c?.parts || []).map((p: any) => p?.text).join(' '), 200) }))
      : undefined
  } else {
    // OpenAI and default ChatMessage[]
    if (typeof instructions === 'string' && instructions) {
      out.instructions = previewText(instructions, 200)
    } else if (typeof system === 'string' && system) {
      out.instructions = previewText(system, 200)
    }
    out.messages = Array.isArray(messages)
      ? messages.map((m: any, i: number) => ({ idx: i, role: m?.role, preview: previewText(m?.content, 200) }))
      : undefined
  }

  if (extras?.responseSchema) {
    out.responseSchema = {
      name: extras.responseSchema.name,
      strict: !!extras.responseSchema.strict,
      keys: Object.keys(extras.responseSchema.schema?.properties || {})
    }
  }
  if (extras?.tools) {
    out.tools = (extras.tools || []).map((t) => t?.name).filter(Boolean)
  }
  return out
}

function logLLMRequestPayload(args: {
  provider: string
  model?: string
  streamType: 'chat' | 'agent'
  streamOpts: any
  responseSchema?: any
  tools?: AgentTool[]
}) {
  try {
    const payload = buildLoggablePayload(args.provider, args.streamOpts, { responseSchema: args.responseSchema, tools: args.tools })
    console.log('[LLMRequest] Payload', {
      provider: args.provider,
      model: args.model,
      streamType: args.streamType,
      payload
    })
  } catch {}
}

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
  const readLinesCache = new Map<string, string>()
  const readFileCache = new Map<string, string>()


  const parseHandle = (h?: string): { p?: string; s?: number; e?: number } | null => {
    if (!h) return null
    try { return JSON.parse(Buffer.from(String(h), 'base64').toString('utf-8')) } catch { return null }
  }

  return (tools || []).map((t) => {
    if (!t || !t.name || typeof t.run !== 'function') return t

    if ((t.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === 'workspacesearch') {
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
          try { wsSearchSeen.set(key, out) } catch { }
          return out
        }
      }
      return wrapped
    }

    if ((t.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === 'fsreadlines') {
      const orig = t.run.bind(t)
      const wrapped: AgentTool = {
        ...t,
        run: async (input: any, meta?: any) => {
          const args = input || {}
          const h = parseHandle(args.handle)
          const rel = (args.path as string) || (h && h.p) || ''
          // Build a signature key that captures the specific range/window requested
          const sigKey = JSON.stringify({
            tool: t.name,
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
              return `Error: read_locked: read limit reached for this range`
            }
          }

          // Dedupe identical reads — return cached raw text
          if (policy?.dedupeReadLines) {
            const key = JSON.stringify({ tool: t.name, path: rel, handle: !!args.handle, mode: args.mode || 'range', start: args.startLine, end: args.endLine, focus: args.focusLine, window: args.window, before: args.beforeLines, after: args.afterLines })
            if (readLinesSeen.has(key)) {
              if (readLinesCache.has(key)) return readLinesCache.get(key) as string
              return ''
            }
            readLinesSeen.add(key)
          }

          const out = await orig(args, meta)

          if (typeof policy?.maxReadLinesPerFile === 'number') {
            const c = readLinesPerFile.get(sigKey) || 0
            readLinesPerFile.set(sigKey, c + 1)
          }

          // Cache raw text for dedupe
          try {
            if (typeof out === 'string') {
              const key = JSON.stringify({ tool: t.name, path: rel, handle: !!args.handle, mode: args.mode || 'range', start: args.startLine, end: args.endLine, focus: args.focusLine, window: args.window, before: args.beforeLines, after: args.afterLines })
              readLinesCache.set(key, out)
            }
          } catch { }

          return out
        }
      }
      return wrapped
    }

    if ((t.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === 'fsreadfile') {
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
              return `Error: read_locked: fsReadFile per-file read limit reached`
            }
          }

          // Dedupe identical reads
          if (policy?.dedupeReadFile) {
            const key = JSON.stringify({ tool: t.name, path: rel })
            if (readFileSeen.has(key)) {
              if (readFileCache.has(key)) return readFileCache.get(key) as string
              return ''
            }
            readFileSeen.add(key)
          }

          const out = await orig(args, meta)

          if (typeof policy?.maxReadFilePerFile === 'number' && rel) {
            const c = readFilePerFile.get(rel) || 0
            readFilePerFile.set(rel, c + 1)
          }
          try {
            if (typeof out === 'string') {
              const key = JSON.stringify({ tool: t.name, path: rel })
              readFileCache.set(key, out)
            }
          } catch { }
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

  /** Optional reasoning effort override (for reasoning-capable models) */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

/**
 * Response from the LLM service
 */
export interface LLMServiceResponse {
  /** Assistant's response text */
  text: string

  /** Optional reasoning/thinking from the model (Gemini 2.5, Fireworks reasoning models) */
  reasoning?: string

  /** Error message if request failed */
  error?: string
}

/**
 * Format messages for OpenAI
 * OpenAI accepts our ChatMessage format directly (but we strip metadata)
 */
function formatMessagesForOpenAI(context: MainFlowContext): ChatMessage[] {
  const messages: ChatMessage[] = []

  // Normalize history defensively – messageHistory must always be an array here
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []

  // Add system instructions if present
  if (context.systemInstructions) {
    messages.push({ role: 'system', content: context.systemInstructions })
  }

  // Add all message history (strip metadata - OpenAI doesn't accept extra fields)
  messages.push(...history.map(m => ({
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

  // Normalize history defensively – messageHistory must always be an array here
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []

  // Convert message history (exclude system messages, only user/assistant)
  const messages = history
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

  // Normalize history defensively – messageHistory must always be an array here
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []

  // Convert message history to Gemini format
  const contents = history
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
    const {
      overrideProvider: requestProvider,
      overrideModel: requestModel,
      message,
      tools,
      responseSchema,
      skipHistory,
      reasoningEffort: requestReasoningEffort,
      flowAPI,
    } = request

    const currentNodeId = flowAPI.nodeId
    const currentExecutionId = flowAPI.executionId

    // 1. Prepare context (history, system prompt) via ContextManager.
    // The scheduler is the single source of truth for context; flowAPI.context
    // is a ContextManager that owns that state. We read via get() and mutate
    // via addMessage(s), never by constructing whole contexts here.
    const contextManager = flowAPI.context as unknown as ContextManager
    const context: MainFlowContext = contextManager.get()
    let workingContext = context

    // Resolve effective provider/model using explicit request fields first,
    // then falling back to the execution context. This ensures that when
    // llmRequest.ts passes only a context (the common case), we still pick
    // up provider/model from that context instead of ending up `undefined`.
    const effectiveProvider = requestProvider || context.provider
    const effectiveModel = requestModel || context.model

    // TEMP: log what we actually see so we can verify context wiring
    try {
      flowAPI.log?.debug?.('LLMService.chat provider/model resolution', {
        requestProvider,
        requestModel,
        contextProvider: context?.provider,
        contextModel: context?.model,
        effectiveProvider,
        effectiveModel,
      })
    } catch {}

    if (!effectiveProvider) {
      return {
        text: '',
        error: 'Unknown provider: undefined (no provider on request or context)',
      }
    }

    const providerAdapter: ProviderAdapter | undefined = providers[effectiveProvider]
    if (!providerAdapter) {
      return {
        text: '',
        error: `Unsupported provider: ${effectiveProvider}`,
      }
    }

    // 1. Get provider adapter
    // providerAdapter already resolved above

    // 2. Get API key
    const apiKey = await getProviderKey(effectiveProvider)
    if (!apiKey) {
      return {
        text: '',
        error: `Missing API key for provider: ${effectiveProvider}`,
      }
    }

    // 3. Append user message via ContextManager (for non-skipHistory)
    if (!skipHistory) {
      contextManager.addMessage({ role: 'user', content: message })
      workingContext = contextManager.get()
    }

    // 4. Format messages for the specific provider
    // llm-service is responsible for converting MainFlowContext to provider-specific format
    let formattedMessages: any

	if (skipHistory) {
	  // For stateless calls (like intentRouter), just send the message directly
      // Format it appropriately for each provider
      if (effectiveProvider === 'anthropic') {
        // Include system instructions even in stateless mode (skipHistory)
        const systemText = context.systemInstructions || ''
        const system = systemText
          ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
          : undefined
        formattedMessages = {
          system,
          messages: [{ role: 'user' as const, content: message }]
        }
      } else if (effectiveProvider === 'gemini') {
        // Include systemInstruction even in stateless mode (skipHistory)
        formattedMessages = {
          systemInstruction: context.systemInstructions || '',
          contents: [{ role: 'user', parts: [{ text: message }] }]
        }
      } else {
        // OpenAI and others — include a system message first if present
        formattedMessages = [
          ...(context.systemInstructions ? [{ role: 'system' as const, content: context.systemInstructions }] : []),
          { role: 'user' as const, content: message }
        ]
      }
	} else {
	  // Normal case: format full conversation history for the provider.
	  // At this point the user message has already been appended to
	  // the canonical context via ContextManager.
	  const latestContext = workingContext
	  if (effectiveProvider === 'anthropic') {
	    formattedMessages = formatMessagesForAnthropic(latestContext)
	  } else if (effectiveProvider === 'gemini') {
	    formattedMessages = formatMessagesForGemini(latestContext)
	  } else {
	    formattedMessages = formatMessagesForOpenAI(latestContext)
	  }
	}

    // 5. Set up event handlers using the new execution event system
    // Convert execution events to legacy callbacks for now (migration adapter)
    // Wrap emitter to suppress chunk events if skipHistory is true (with debug override)
    const emit = skipHistory
      ? (event: any) => {
        // By default, suppress chunk events for stateless calls (like intentRouter)
        // Set HF_SHOW_SKIP_HISTORY_CHUNKS=1 to forward chunks for debugging/visibility.
        const showSkipChunks = process.env.HF_SHOW_SKIP_HISTORY_CHUNKS === '1'
        if (event.type === 'chunk') {
          if (showSkipChunks) {
            if (process.env.HF_FLOW_DEBUG === '1') {
              const brief = (event.chunk || '').slice(0, 40)
              console.log('[llm-service] forwarding skipHistory chunk due to HF_SHOW_SKIP_HISTORY_CHUNKS', { nodeId: flowAPI.nodeId, brief })
            }
            flowAPI.emitExecutionEvent(event)
          }
          // else: drop chunk
          return
        }
        flowAPI.emitExecutionEvent(event)
      }
      : flowAPI.emitExecutionEvent

    // Bind callback event emitters using the resolved provider/model
    const eventHandlers = createCallbackEventEmitters(emit, effectiveProvider, effectiveModel)


    // Track tool I/O sizes for usage breakdown (estimated tokens)
    let __toolArgsTokensOut = 0
    let __toolResultsTokensIn = 0
    let __toolCallsOutCount = 0
    let __toolArgsTokensByTool: Record<string, number> = {}
    let __toolResultsTokensByTool: Record<string, number> = {}
    let __toolCallsByTool: Record<string, number> = {}

    const toolKey = (name?: string) => String(name || '').trim()

    // Usage breakdown capture (OpenAI path)
    // Reusable OpenAI tokenizer for this request (freed after breakdown emission)
    let __openaiEncoder: any | null = null

    function getOpenAIEncoderForModel(m: string) {
      if (__openaiEncoder) return __openaiEncoder
      try {
        __openaiEncoder = encoding_for_model(m as any)
      } catch {
        try {
          const useO200k = /(^o\d|o\d|gpt-4o|gpt-4\.1)/i.test(m)
          __openaiEncoder = get_encoding(useO200k ? 'o200k_base' : 'cl100k_base')
        } catch { }
      }
      return __openaiEncoder
    }


    // Generalized token counter: precise for OpenAI (tiktoken), estimated otherwise
    function getTokenCounter(p: string, m: string) {
      if (p === 'openai') {
        const hasEnc = !!getOpenAIEncoderForModel(m)
        if (hasEnc) {
          return { count: (t: string) => getOpenAIEncoderForModel(m)!.encode(t).length, precise: true }
        }
      }
      return { count: estimateTokensFromText, precise: false }
    }

    const __tokenCounter = getTokenCounter(effectiveProvider, effectiveModel)


    let __bdSystemText: string | undefined
    let __bdMessages: any[] | undefined


    const onToolStartWrapped = (ev: { callId?: string; name: string; arguments?: any }) => {
      try {
        __toolCallsOutCount++
        const key = toolKey(ev?.name)
        __toolCallsByTool[key] = (__toolCallsByTool[key] || 0) + 1
        if (ev && ev.arguments != null) {
          const s = typeof ev.arguments === 'string' ? ev.arguments : JSON.stringify(ev.arguments)
          const t = __tokenCounter.count(s)
          __toolArgsTokensOut += t
          __toolArgsTokensByTool[key] = (__toolArgsTokensByTool[key] || 0) + t
        }
      } catch { }
      eventHandlers.onToolStart(ev)
    }
    const onToolEndWrapped = (ev: { callId?: string; name: string; result?: any }) => {
      try {
        const key = toolKey(ev?.name)
        if (ev && (ev as any).result != null) {
          const s = typeof (ev as any).result === 'string' ? (ev as any).result : JSON.stringify((ev as any).result)
          const t = __tokenCounter.count(s)
          __toolResultsTokensIn += t
          __toolResultsTokensByTool[key] = (__toolResultsTokensByTool[key] || 0) + t

          // Resolve heavy UI payload via previewKey and register for UI rendering
          const callId = ev?.callId
          const pk = (ev as any)?.result?.previewKey
          if (callId && pk) {
            // First try non-destructive read in case multiple consumers race
            const data = UiPayloadCache.peek(pk)
            if (typeof data !== 'undefined') {
              try { flowAPI.store.getState().registerToolResult({ key: callId, data }) } catch { }
            } else {
              // Schedule a microtask to try again after providers finish caching
              setTimeout(() => {
                const later = UiPayloadCache.peek(pk)
                if (typeof later !== 'undefined') {
                  try { flowAPI.store.getState().registerToolResult({ key: callId, data: later }) } catch { }
                }
              }, 0)
            }
          }
        }
      } catch { }
      eventHandlers.onToolEnd(ev as any)
    }

    // Track latest usage (if provider reports it) and maintain a best-effort fallback
    let lastReportedUsage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number } | null = null
    // Accumulate deltas across all steps so we can report accurate totals in usage_breakdown
    let accumulatedUsage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number } = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
    let usageEmitted = false
    const emitUsage = eventHandlers.onTokenUsage
    const onTokenUsageWrapped = (u: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number }) => {
      const prev = lastReportedUsage
      // Determine cumulative by totalTokens only; providers may report non-monotonic input/output per step
      const currTotal = (u?.totalTokens ?? ((u?.inputTokens || 0) + (u?.outputTokens || 0)))
      const prevTotal = (prev?.totalTokens ?? ((prev?.inputTokens || 0) + (prev?.outputTokens || 0)))
      const isCumulative = !!prev && currTotal >= prevTotal

      let delta = u
      if (prev && isCumulative) {
        const dTotal = Math.max(0, currTotal - prevTotal)
        const dIn = Math.max(0, (u.inputTokens || 0) - (prev.inputTokens || 0))
        // Assign remainder to output; clamp to non-negative
        const dOut = Math.max(0, dTotal - dIn)
        delta = {
          inputTokens: dIn,
          outputTokens: dOut,
          totalTokens: Math.max(0, dIn + dOut),
          cachedTokens: Math.max(0, (u.cachedTokens || 0) - (prev.cachedTokens || 0)),
          reasoningTokens: Math.max(0, (u.reasoningTokens || 0) - (prev.reasoningTokens || 0))
        }
      }

      if (DEBUG_USAGE) {
        try {
          console.log('[usage:onTokenUsageWrapped]', {
            mode: isCumulative ? 'cumulative->delta' : 'per-step',
            raw: u,
            prev,
            delta
          })
        } catch { }
      }

      // Accumulate deltas so we can compute accurate totals later
      accumulatedUsage = {
        inputTokens: (accumulatedUsage.inputTokens || 0) + (delta.inputTokens || 0),
        outputTokens: (accumulatedUsage.outputTokens || 0) + (delta.outputTokens || 0),
        totalTokens: (accumulatedUsage.totalTokens || 0) + (delta.totalTokens || 0),
        cachedTokens: (accumulatedUsage.cachedTokens || 0) + (delta.cachedTokens || 0),
        reasoningTokens: (accumulatedUsage.reasoningTokens || 0) + (delta.reasoningTokens || 0)
      }

      lastReportedUsage = u

      // Only emit non-zero deltas to avoid double-counting
      if (
        (delta.inputTokens || 0) > 0 ||
        (delta.outputTokens || 0) > 0 ||
        (delta.totalTokens || 0) > 0 ||
        (delta.cachedTokens || 0) > 0 ||
        (delta.reasoningTokens || 0) > 0
      ) {
        usageEmitted = true
        emitUsage(delta)
      }
    }

    // Pre-compute an approximate input token count as a fallback
    const approxInputTokens = estimateInputTokens(effectiveProvider, formattedMessages)

    // 6. Call provider with formatted messages

    // --- Resolve effective sampling parameters with model-specific overrides ---
    // Model overrides take precedence over defaults
    const modelOverrides: Array<{
      model: string
      temperature?: number
      reasoningEffort?: 'low' | 'medium' | 'high'
      includeThoughts?: boolean
      thinkingBudget?: number
    }> = ((workingContext as any)?.modelOverrides || [])

    // Find override for current model (exact match)
    const modelOverride = modelOverrides.find(o => o.model === effectiveModel)

    // Temperature: model override → mapped normalized value → raw context value
    let effectiveTemperature: number | undefined
    if (modelOverride?.temperature !== undefined) {
      // Model-specific override (raw value)
      effectiveTemperature = modelOverride.temperature
    } else if (typeof (workingContext as any)?.temperature === 'number') {
      const normalizedTemp = (workingContext as any).temperature
      // Map normalized (0-1) to provider range:
      // - OpenAI/Gemini/Fireworks/xAI: 0-2
      // - Anthropic: 0-1 (already normalized)
      if (effectiveProvider === 'anthropic') {
        effectiveTemperature = Math.min(normalizedTemp, 1) // Clamp to 0-1
      } else {
        effectiveTemperature = normalizedTemp * 2 // Scale to 0-2
      }
    }

    // Reasoning effort: model override → default
    const effectiveReasoningEffort =
      requestReasoningEffort ??
      modelOverride?.reasoningEffort ??
      (workingContext as any)?.reasoningEffort

    // Auto-enable thinking for models that support it:
    // - Gemini 2.5+ (2.5, 3-pro, 3.0, 3.5, etc.): /(2\.5|[^0-9]3[.-])/i
    // - Anthropic Claude 3.5+ Sonnet, 3.7+, 4+
    const isGeminiWithThinking = effectiveProvider === 'gemini' && /(2\.5|[^0-9]3[.-])/i.test(effectiveModel)
    const isAnthropicWithThinking = effectiveProvider === 'anthropic' && (
      /claude-4/i.test(effectiveModel) || /claude-opus-4/i.test(effectiveModel) || /claude-sonnet-4/i.test(effectiveModel) || /claude-haiku-4/i.test(effectiveModel) ||
      /claude-3-7-sonnet/i.test(effectiveModel) || /claude-3\.7/i.test(effectiveModel) ||
      /claude-3-5-sonnet/i.test(effectiveModel) || /claude-3\.5-sonnet/i.test(effectiveModel)
    )
    const modelSupportsThinking = isGeminiWithThinking || isAnthropicWithThinking

    // Include thoughts: model override → default (with auto-enable for supported models)
    const includeThoughtsOverride = modelOverride?.includeThoughts
    const includeThoughtsDefault = workingContext?.includeThoughts
    const shouldIncludeThoughts = includeThoughtsOverride === true ||
      (includeThoughtsOverride !== false && includeThoughtsDefault === true) ||
      (includeThoughtsOverride === undefined && includeThoughtsDefault !== false && modelSupportsThinking)

    // Thinking budget: model override → default
    const thinkingBudgetOverride = modelOverride?.thinkingBudget
    const thinkingBudgetDefault = (workingContext as any)?.thinkingBudget
    const effectiveThinkingBudget = typeof thinkingBudgetOverride === 'number'
      ? thinkingBudgetOverride
      : (typeof thinkingBudgetDefault === 'number'
        ? thinkingBudgetDefault
        : (shouldIncludeThoughts && modelSupportsThinking ? 2048 : undefined))

    let response = ''
    let reasoning = '' // Accumulate reasoning/thinking from provider

    // NOTE: This entire block must live inside an async function so that
    // we can legally use `await` for proactive rate limiting and streaming.
    // Ensure the containing method (`chat`) is declared `async`.
    try {
      // PROACTIVE RATE LIMIT CHECK - Wait before making request if needed.
      // This must remain async-aware so we can pause before issuing the
      // underlying provider call when we are near rate limits.
      const waitMs = await rateLimitTracker.checkAndWait(effectiveProvider as any, effectiveModel)
      if (waitMs > 0) {
        // Emit event to UI so the user understands why their request is delayed.
        flowAPI.emitExecutionEvent({
          type: 'rate_limit_wait',
          provider: effectiveProvider,
          model: effectiveModel,
          rateLimitWait: {
            attempt: 0, // 0 = proactive wait (not a retry)
            waitMs,
            reason: 'Proactive rate limit enforcement',
          },
        })

        await sleep(waitMs)
      }

      // Record this request (optimistic tracking) after any proactive wait.
      rateLimitTracker.recordRequest(effectiveProvider as any, effectiveModel)

      await new Promise<void>(async (resolve, reject) => {
        let streamHandle: { cancel: () => void } | null = null
        const onAbort = () => {
          try { streamHandle?.cancel() } catch { }
          try {
            // Best-effort usage on cancel: prefer provider-reported usage; otherwise estimate
            if (!usageEmitted && lastReportedUsage) {
              usageEmitted = true
              emitUsage(lastReportedUsage)
            } else if (!usageEmitted) {
              const approxOutput = __tokenCounter.count(response)
              usageEmitted = true
              emitUsage({ inputTokens: approxInputTokens, outputTokens: approxOutput, totalTokens: approxInputTokens + approxOutput })
            }
          } catch { }
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
            model: effectiveModel,
            // Wrap emit to capture reasoning for persistence
            emit: (event: any) => {
              // Capture reasoning events for later persistence
              if (event.type === 'reasoning' && event.reasoning) {
                reasoning += event.reasoning
              }
              // Forward to original emit
              emit(event)
            },
            // Sampling + reasoning controls (using effective values with model overrides applied)
            ...(typeof effectiveTemperature === 'number' ? { temperature: effectiveTemperature } : {}),
            ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
            // Thinking controls - auto-enabled for supported models
            ...(shouldIncludeThoughts ? { includeThoughts: true } : {}),
            ...(effectiveThinkingBudget !== undefined ? { thinkingBudget: effectiveThinkingBudget } : {}),
            // Callbacks that providers call - these are wrapped to emit ExecutionEvents
            onChunk: (text: string) => {
              if (!text) return
              if (process.env.HF_FLOW_DEBUG === '1') {
                try { console.log(`[llm-service] onChunk node=${flowAPI.nodeId} provider=${effectiveProvider}/${effectiveModel} len=${text?.length}`) } catch { }
              }

              // Robust de-dup/overlap handling for providers that resend accumulated text
              // Cases handled:
              // 1) Exact duplicate of full response → drop
              // 2) Aggregated resend (chunk starts with previous response) → emit only the delta
              // 3) Overlap resend (chunk repeats trailing suffix of response) → emit only the non-overlapping suffix

              // 1) Exact duplicate of full response
              if (text === response) return

              // 2) Aggregated resend
              if (response && text.startsWith(response)) {
                const delta = text.slice(response.length)
                if (!delta) return
                response = text
                eventHandlers.onChunk(delta)
                return
              }

              // 3) Overlap resend
              let delta = text
              if (response) {
                if (response.endsWith(text)) {
                  // Entire chunk already present at the end → drop
                  return
                }
                // Find the longest suffix of response that is a prefix of text
                const maxOverlap = Math.min(response.length, text.length)
                for (let k = maxOverlap; k > 0; k--) {
                  if (response.slice(response.length - k) === text.slice(0, k)) {
                    delta = text.slice(k)
                    break
                  }
                }
              }

              if (!delta) return
              response += delta
              eventHandlers.onChunk(delta)
            },
            onDone: () => {

              try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch { }
              resolve()
            },
            onError: (error: string) => {

              try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch { }
              reject(new Error(error))
            },
            onTokenUsage: onTokenUsageWrapped
          }

          // Provider-specific options
          let streamOpts: any
          if (effectiveProvider === 'anthropic') {
            streamOpts = {
              ...baseStreamOpts,
              system: formattedMessages.system,
              messages: formattedMessages.messages
            }
          } else if (effectiveProvider === 'gemini') {
            streamOpts = {
              ...baseStreamOpts,
              systemInstruction: formattedMessages.systemInstruction,
              contents: formattedMessages.contents
            }
          } else {
            // OpenAI and others: split system out for top-level and avoid duplication
            let systemText: string | undefined
            let nonSystemMessages: any = formattedMessages
            if (Array.isArray(formattedMessages)) {
              const sysParts: string[] = []
              nonSystemMessages = (formattedMessages as any[]).map((m: any) => {
                if (m?.role === 'system') { sysParts.push(typeof m.content === 'string' ? m.content : String(m.content)); return null }
                return m
              }).filter(Boolean)
              if (sysParts.length) systemText = sysParts.join('\n\n')
            }

	    try { flowAPI.log.debug('llmService.chat building stream options', { provider: effectiveProvider, model: effectiveModel }) } catch { }

            streamOpts = {
              ...baseStreamOpts,
              ...(systemText ? { system: systemText } : {}),
              messages: systemText ? nonSystemMessages : formattedMessages
            }
            // Capture for usage breakdown
            __bdSystemText = systemText
            __bdMessages = (systemText ? nonSystemMessages : formattedMessages) as any[]
          }

          // Single streaming path: agentStream (tools may be empty)
          // Detailed one-time payload log (sanitized)
          logLLMRequestPayload({
            provider: effectiveProvider,
            model: effectiveModel,
            streamType: 'agent',
            streamOpts,
            responseSchema,
            tools
          })

          // Wrap provider call with retry logic
          await withRetries(
            async () => {
              const policyTools = (tools && tools.length)
                ? wrapToolsWithPolicy(tools, {
                  // Disable dedupe for fsReadLines/fsReadFile to ensure RAW text is returned (no cached JSON stubs)
                  dedupeReadLines: false,
                  // Remove re-read limits for fsReadLines so LLMs can read, edit, then re-read to verify

                  dedupeReadFile: false,
                })
                : []
              streamHandle = await providerAdapter.agentStream({
                ...streamOpts,
                tools: policyTools,
                responseSchema,
                toolMeta: { requestId: context.contextId, workspaceId: (flowAPI as any)?.workspaceId }, // Include workspace for tool scoping
                onToolStart: onToolStartWrapped,
                onToolEnd: onToolEndWrapped,
                onToolError: eventHandlers.onToolError
              })

              try { flowAPI.log.debug('llmService.chat agentStream started', { provider: effectiveProvider, model: effectiveModel }) } catch { }

            },
            {
              max: 3,
              maxWaitMs: 60000,
              onRateLimitWait: ({ attempt, waitMs, reason }: { attempt: number; waitMs: number; reason?: string }) => {


                // Emit event to UI
                flowAPI.emitExecutionEvent({
                  type: 'rate_limit_wait',
                  provider: effectiveProvider,
                  model: effectiveModel,
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

            rateLimitTracker.updateFromError(effectiveProvider as any, effectiveModel, e, rateLimitInfo)
          }

          try { flowAPI.signal?.removeEventListener('abort', onAbort as any) } catch { }
          reject(e)
        }
      })
    } catch (e: any) {
      const errorMessage = e.message || String(e)


      // Treat cancellations/terminations as non-errors for UI event emission
      const isCancellation = /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(errorMessage)
      if (!isCancellation) {
        // Send error event to UI only for real errors
        eventHandlers.onError(errorMessage)
      } else {

      }


	      return {
	        text: '',
	        error: errorMessage
	      }
    }

    // Emit usage breakdown (general; precise when tokenizer available)
    try {
      const __count = __tokenCounter.count
      const __precise = !!__tokenCounter.precise

      const instructionsTokens = __count(__bdSystemText || '')
      let userMsgTokens = 0
      let assistantMsgTokens = 0
      if (Array.isArray(__bdMessages)) {
        for (const m of __bdMessages) {
          const role = (m && (m as any).role) || ''
          const content = (m && (m as any).content) ?? ''
          const t = __count(typeof content === 'string' ? content : String(content))
          if (role === 'user') userMsgTokens += t
          else if (role === 'assistant') assistantMsgTokens += t
        }
      }
      const toolDefinitionsTokens = __count(JSON.stringify(tools || []))
      const responseFormatTokens = __count(JSON.stringify(responseSchema || null))
      const toolCallResultsTokens = __toolResultsTokensIn
      const assistantTextTokens = __count(response)
      const toolCallsTokens = __toolArgsTokensOut

      const calcInput = instructionsTokens + userMsgTokens + assistantMsgTokens + toolDefinitionsTokens + responseFormatTokens + toolCallResultsTokens
      const calcOutput = assistantTextTokens + toolCallsTokens

      const reported = lastReportedUsage as any
      const acc = accumulatedUsage
      const hasAccum = (acc && ((acc.inputTokens || 0) > 0 || (acc.outputTokens || 0) > 0 || (acc.totalTokens || 0) > 0))
      const totals = hasAccum
        ? {
          inputTokens: (acc.inputTokens ?? calcInput),
          outputTokens: (acc.outputTokens ?? calcOutput),
          totalTokens: (acc.totalTokens ?? ((acc.inputTokens ?? calcInput) + (acc.outputTokens ?? calcOutput))),
          cachedInputTokens: Math.max(0, acc.cachedTokens || 0)
        }
        : (reported
          ? {
            inputTokens: (reported.inputTokens ?? calcInput),
            outputTokens: (reported.outputTokens ?? calcOutput),
            totalTokens: (reported.totalTokens ?? ((reported.inputTokens ?? calcInput) + (reported.outputTokens ?? calcOutput))),
            cachedInputTokens: Math.max(0, reported.cachedTokens || reported.cachedInputTokens || 0)
          }
          : { inputTokens: calcInput, outputTokens: calcOutput, totalTokens: calcInput + calcOutput, cachedInputTokens: 0 })

      // Cost estimate (provider-aware; cached tokens are separate from input tokens)
      let costEstimate: number | undefined
      try {
      const rateTable: any = (DEFAULT_PRICING as any)[effectiveProvider] || {}
      const rate = rateTable?.[effectiveModel]
        if (rate) {
          const cachedTokens = Math.max(0, Number((totals as any).cachedInputTokens || 0))
          const totalInputTokens = Math.max(0, Number((totals as any).inputTokens || 0))
          const normalInputTokens = Math.max(0, totalInputTokens - cachedTokens)
          const cachedPer1M = (rate as any).cachedInputCostPer1M ?? rate.inputCostPer1M

          costEstimate = (normalInputTokens / 1_000_000) * rate.inputCostPer1M
            + (cachedTokens / 1_000_000) * cachedPer1M
            + (Number((totals as any).outputTokens || 0) / 1_000_000) * rate.outputCostPer1M
        }
      } catch { }

      const thoughtsTokens = Math.max(0, Number(totals.outputTokens || 0) - (assistantTextTokens + toolCallsTokens))

      // Defensive: ensure we have stable node/execution identifiers for the badge keying
      let usageNodeId = currentNodeId
      let usageExecutionId = currentExecutionId
      try {
        // Prefer explicit properties if available, but fall back to context
        const flowNodeId = (flowAPI as any)?.nodeId ?? (flowAPI as any)?.context?.nodeId
        const flowExecutionId = (flowAPI as any)?.executionId ?? (flowAPI as any)?.context?.executionId

        if (!usageNodeId && flowNodeId) usageNodeId = flowNodeId
        if (!usageExecutionId && flowExecutionId) usageExecutionId = flowExecutionId
      } catch { /* best-effort only */ }

      if (!usageNodeId || !usageExecutionId) {
        console.warn('[LLM] usage_breakdown missing nodeId/executionId', {
          nodeId: usageNodeId,
          executionId: usageExecutionId,
        })
      } else {
        console.debug('[LLM] emitting usage_breakdown', {
          nodeId: usageNodeId,
          executionId: usageExecutionId,
        })
      }

      flowAPI.emitExecutionEvent({
        type: 'usage_breakdown',
        provider: effectiveProvider,
        model: effectiveModel,
        usageBreakdown: {
          input: {
            instructions: instructionsTokens,
            userMessages: userMsgTokens,
            assistantMessages: assistantMsgTokens,
            toolDefinitions: toolDefinitionsTokens,
            responseFormat: responseFormatTokens,
            toolCallResults: toolCallResultsTokens
          },
          output: {
            assistantText: assistantTextTokens,
            thoughts: thoughtsTokens,
            toolCalls: toolCallsTokens
          },
          totals: { ...totals, costEstimate },
          estimated: !__precise,
          tools: Object.fromEntries(
            Array.from(
              new Set([
                ...Object.keys(__toolArgsTokensByTool || {}),
                ...Object.keys(__toolResultsTokensByTool || {})
              ])
            ).map((k) => [
              k,
              {
                calls: __toolCallsByTool[k] || 0,
                inputResults: __toolResultsTokensByTool[k] || 0,
                outputArgs: __toolArgsTokensByTool[k] || 0
              }
            ])
          )
        }
      })

      // Free encoder if allocated (OpenAI)
      if (__openaiEncoder) { try { __openaiEncoder.free() } catch { } __openaiEncoder = null }
    } catch (e) {
      console.warn('[LLM] failed to emit usage_breakdown', e)
    }

    // 7. Add assistant response to context (unless skipHistory)
    if (!skipHistory) {
      const assistantMessage: { role: 'assistant'; content: string; reasoning?: string } = {
        role: 'assistant',
        content: response,
      }
      if (reasoning.trim()) {
        assistantMessage.reasoning = reasoning
      }
      contextManager.addMessage(assistantMessage)
    }

    return {
      text: response,
      reasoning: reasoning.trim() || undefined,
    }
  }
}

// Singleton instance
export const llmService = new LLMService()

