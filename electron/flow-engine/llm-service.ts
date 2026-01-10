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

import type { MainFlowContext, MessagePart } from './types'
import type { FlowAPI, Tool as FlowTool } from './flow-api'
import type { ContextManager } from './contextManager'
import type { AgentTool, ProviderAdapter } from '../providers/provider'

import { inspect } from 'util'

import { getProviderKey, providers } from '../core/state'
import { getAgentToolSnapshot } from '../tools/agentToolRegistry.js'
import { createCallbackEventEmitters } from './execution-events'
import { rateLimitTracker } from '../providers/rate-limit-tracker'
import { parseRateLimitError, sleep } from '../providers/retry'
import {
  estimateInputTokens,
  formatMessagesForAnthropic,
  formatMessagesForOpenAI,
  logLLMRequestPayload,
} from './llm/payloads'

import { createTokenCounter, ToolUsageTracker, UsageAccumulator, StepCategoryBreakdown } from './llm/usage-tracker'
import { resolveSamplingControls } from './llm/stream-options'
import { wrapToolsWithPolicy } from './llm/tool-policy'
import { getSettingsService } from '../services/index.js'
import type { TokenUsage } from '../store/types.js'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'

// Debug logging for semantic tools debugging
const DEBUG_LLM_FILE = process.env.HF_DEBUG_LLM_FILE === '1'
let debugLogPath: string | null = null

function getDebugLogPath(): string {
  if (!debugLogPath) {
    try {
      const userDataPath = app.getPath('userData')
      debugLogPath = path.join(userDataPath, 'llm-debug.log')
    } catch {
      debugLogPath = '/tmp/hifide-llm-debug.log'
    }
  }
  return debugLogPath
}

function debugLog(category: string, data: any) {
  if (!DEBUG_LLM_FILE) return
  try {
    const timestamp = new Date().toISOString()
    const entry = {
      timestamp,
      category,
      ...data
    }
    const logLine = JSON.stringify(entry, null, 2) + '\n\n---\n\n'
    fs.appendFileSync(getDebugLogPath(), logLine)
  } catch (e) {
    console.error('[debugLog] Failed to write:', e)
  }
}

function clearDebugLog() {
  if (!DEBUG_LLM_FILE) return
  try {
    fs.writeFileSync(getDebugLogPath(), `=== LLM Debug Log Started ${new Date().toISOString()} ===\n\n`)
  } catch {}
}




/**
 * Request to the LLM service
 */
export interface LLMServiceRequest {
  /** User message to send */
  message: string | MessagePart[]

  /** Optional tools for agent mode */
  tools?: Array<AgentTool | FlowTool>

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

  /**
   * Optional per-call system instructions.
   * Applied only to this request's provider payload; must not be persisted to the flow context.
   */
  systemInstructions?: string

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
    // Clear debug log at the start of each chat
    clearDebugLog()

    const {
      overrideProvider: requestProvider,
      overrideModel: requestModel,
      message,
      tools: requestedTools,
      responseSchema,
      skipHistory,
      reasoningEffort: requestReasoningEffort,
      flowAPI,
    } = request

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

    const { tools: hydratedTools, missing } = hydrateAgentTools(requestedTools, flowAPI.workspaceId)
    if (missing.length) {
      try {
        flowAPI.log?.warn?.('llmService.chat missing agent tool implementations', { missing })
      } catch {}
    }

    // 3. Append user message via ContextManager (for non-skipHistory)
    if (!skipHistory) {
      const normalizedIncoming = normalizeUserMessageContent(message)
      const existingHistory = Array.isArray(workingContext?.messageHistory)
        ? workingContext.messageHistory
        : []
      const lastEntry = existingHistory[existingHistory.length - 1]
      const normalizedLast = normalizeUserMessageContent(lastEntry?.content)

      const isContentEqual = (a: any, b: any) => {
        if (typeof a === 'string' && typeof b === 'string') return a === b
        if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
        return false
      }

      const alreadyAppended =
        !!lastEntry &&
        lastEntry.role === 'user' &&
        ((typeof normalizedIncoming === 'string' && normalizedIncoming.length > 0) ||
          Array.isArray(normalizedIncoming)) &&
        isContentEqual(normalizedIncoming, normalizedLast)

      if (!alreadyAppended) {
        const contentToStore = normalizedIncoming || message
        contextManager.addMessage({ role: 'user', content: contentToStore })
      }

      workingContext = contextManager.get()
    }


    // 4. Format messages for the specific provider
    // llm-service is responsible for converting MainFlowContext to provider-specific format
    let formattedMessages: any

    // Detect if we should use Anthropic formatting (with cache_control markers)
    // This applies to native Anthropic provider OR Anthropic models via OpenRouter
    const isAnthropicModel = effectiveProvider === 'anthropic' ||
      (effectiveProvider === 'openrouter' && /claude|anthropic/i.test(effectiveModel))

	if (skipHistory) {
	  // For stateless calls (like intentRouter), just send the message directly
      // Format it appropriately for each provider
      if (isAnthropicModel) {
        // Include system instructions even in stateless mode (skipHistory)
        // Use cache_control for Anthropic models (works via OpenRouter too)
        const systemText = request.systemInstructions ?? context.systemInstructions ?? ''
        const system = systemText
          ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
          : undefined
        formattedMessages = {
          system,
          messages: [{ role: 'user' as const, content: message }]
        }
      } else {
        // OpenAI and others — include a system message first if present
        const systemText = request.systemInstructions ?? context.systemInstructions
        formattedMessages = [
          ...(systemText ? [{ role: 'system' as const, content: systemText }] : []),
          { role: 'user' as const, content: message }
        ]
      }
	} else {
	  // Normal case: format full conversation history for the provider.
	  // At this point the user message has already been appended to
	  // the canonical context via ContextManager.
	  // If request.systemInstructions is provided (e.g., with injected memories),
	  // use it for this request without mutating the canonical context.
	  const latestContext: MainFlowContext = request.systemInstructions
	    ? { ...workingContext, systemInstructions: request.systemInstructions }
	    : workingContext
	  if (isAnthropicModel) {
	    // Use Anthropic formatting with cache_control for native Anthropic or OpenRouter+Claude
	    formattedMessages = formatMessagesForAnthropic(latestContext, { model: effectiveModel })
	  } else {
        formattedMessages = formatMessagesForOpenAI(latestContext, { provider: effectiveProvider, model: effectiveModel })
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


    let __bdSystemText: string | any[] | undefined  // String (OpenAI) or array of blocks (Anthropic)
    let __bdMessages: any[] | undefined

    const registerToolResult = (payload: { key: string; data: unknown }) => {
      try {
        flowAPI.store?.getState?.().registerToolResult?.(payload)
      } catch {}
    }

    const tokenCounter = createTokenCounter(effectiveProvider, effectiveModel)
    const usageAccumulator = new UsageAccumulator()
    const toolUsageTracker = new ToolUsageTracker(tokenCounter, registerToolResult)
    const emitUsage = eventHandlers.onTokenUsage

    const onToolStartWrapped = (ev: { callId?: string; name: string; arguments?: any }) => {
      debugLog('TOOL_START', {
        callId: ev.callId,
        toolName: ev.name,
        arguments: ev.arguments
      })
      try { toolUsageTracker.handleToolStart(ev) } catch {}
      eventHandlers.onToolStart(ev)
    }
    const onToolEndWrapped = (ev: { callId?: string; name: string; result?: any }) => {
      debugLog('TOOL_END', {
        callId: ev.callId,
        toolName: ev.name,
        result: ev.result
      })
      try { toolUsageTracker.handleToolEnd(ev) } catch {}
      eventHandlers.onToolEnd(ev as any)
    }

    const onStepWrapped = (step: { text: string; reasoning?: string; toolCalls?: any[]; toolResults?: any[] }) => {
      debugLog('LLM_STEP', {
        text: step.text,
        reasoning: step.reasoning,
        toolCalls: step.toolCalls,
        toolResults: step.toolResults
      })
      if (skipHistory) return

      // =========================================================================
      // IMPORTANT: We intentionally do NOT persist tool_calls or tool results
      // to the session's messageHistory.
      //
      // Why: During agentic loops, a single turn can generate many tool calls
      // (e.g., 10+ steps with 3+ tool calls each). If we persisted all of this
      // to messageHistory, the next user message would re-send ALL of that data
      // back to the API, causing:
      //   1. Context window explosion (tokens grow exponentially)
      //   2. Model confusion from massive redundant context
      //   3. Formatting issues as models lose track of conversation flow
      //
      // The providers handle their own internal tool loop context:
      //   - AI SDK providers: streamText() with maxSteps manages tool context internally
      //   - OpenRouter: maintains local conversationMessages array for the turn
      //
      // We only persist the assistant's text responses (and reasoning) which
      // represent the actual conversational content the user should see continued.
      // =========================================================================

      // Only persist if there's actual text content (not just tool calls)
      if (!step.text) return

      const assistantMessage: any = {
        role: 'assistant',
        content: step.text,
      }

      // Add reasoning if present
      if (step.reasoning) {
        if (typeof step.reasoning === 'string') {
          assistantMessage.reasoning = step.reasoning
        } else {
          try {
            assistantMessage.reasoning = (step.reasoning as any).text || (step.reasoning as any).content || JSON.stringify(step.reasoning)
          } catch {
            assistantMessage.reasoning = String(step.reasoning)
          }
        }
      }

      contextManager.addMessage(assistantMessage)
    }

    // Per-step tracking state
    // These track cumulative values that grow across steps
    let cumulativeAssistantText = ''
    let cumulativeAssistantReasoning = ''

    // Fixed input token counts (computed lazily on first usage event)
    // These don't change between steps, but we can't compute them until after
    // provider-specific setup assigns __bdSystemText and __bdMessages
    let fixedTokensComputed = false
    let fixedSystemTokens = 0
    let fixedToolDefsTokens = 0
    let fixedUserMsgTokens = 0

    const computeFixedTokens = () => {
      if (fixedTokensComputed) return
      fixedTokensComputed = true

      // Handle system text - can be string or array of Anthropic blocks
      let systemText = ''
      if (typeof __bdSystemText === 'string') {
        systemText = __bdSystemText
      } else if (Array.isArray(__bdSystemText)) {
        // Anthropic format: [{ type: 'text', text: '...' }]
        systemText = __bdSystemText
          .map((block: any) => block?.text || '')
          .filter(Boolean)
          .join('\n')
      }
      fixedSystemTokens = tokenCounter.count(systemText)
      fixedToolDefsTokens = tokenCounter.count(JSON.stringify(hydratedTools || []))
      fixedUserMsgTokens = 0
      if (Array.isArray(__bdMessages)) {
        for (const entry of __bdMessages) {
          const role = (entry && (entry as any).role) || ''
          const content = (entry && (entry as any).content) ?? ''
          if (role === 'user') {
            fixedUserMsgTokens += tokenCounter.count(typeof content === 'string' ? content : String(content))
          }
        }
      }
    }

    const onTokenUsageWrapped = (usage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cachedTokens?: number
      reasoningTokens?: number
      stepCount?: number
      stepOutput?: { text: string; reasoning: string; toolCallArgs: string }
    }) => {
      // Compute fixed token counts on first usage event
      // (after provider-specific setup has assigned __bdSystemText and __bdMessages)
      computeFixedTokens()

      usageAccumulator.recordProviderUsage(
        usage,
        DEBUG_USAGE
          ? (details: any) => {
            try {
              console.log('[usage:onTokenUsageWrapped]', details)
            } catch {}
          }
          : undefined
      )

      // Track per-step category breakdown
      const stepNumber = usage.stepCount || 1
      const stepOutput = usage.stepOutput || { text: '', reasoning: '', toolCallArgs: '' }

      // Calculate output categories for this step
      const outputTextTokens = tokenCounter.count(stepOutput.text || '')
      const outputReasoningTokens = tokenCounter.count(stepOutput.reasoning || '')
      const outputToolCallsTokens = tokenCounter.count(stepOutput.toolCallArgs || '')

      // Calculate input categories for this step
      // Fixed categories (same every step): system, tools, user messages
      // Growing categories: assistant messages, reasoning, tool results
      const assistantMsgTokens = tokenCounter.count(cumulativeAssistantText)
      const assistantReasoningTokens = tokenCounter.count(cumulativeAssistantReasoning)
      // Tool results come from the toolUsageTracker which updates via onToolEndWrapped
      const currentToolResults = toolUsageTracker.getSnapshot().resultsTokensIn

      const categories: StepCategoryBreakdown = {
        // Input (sent to model)
        systemInstructions: fixedSystemTokens,
        toolDefinitions: fixedToolDefsTokens,
        userMessages: fixedUserMsgTokens,
        assistantMessages: assistantMsgTokens,
        assistantReasoning: assistantReasoningTokens,
        toolResults: currentToolResults,
        // Output (produced by model)
        outputText: outputTextTokens,
        outputReasoning: outputReasoningTokens,
        outputToolCalls: outputToolCallsTokens
      }

      // Record this step's usage with categories
      usageAccumulator.recordStepUsage({
        stepNumber,
        categories,
        providerInputTokens: usage.inputTokens || 0,
        providerOutputTokens: usage.outputTokens || 0,
        cachedTokens: usage.cachedTokens || 0
      })

      // Update cumulative values for next step
      // The current step's output becomes part of the next step's input
      if (stepOutput.text) {
        cumulativeAssistantText += (cumulativeAssistantText ? '\n' : '') + stepOutput.text
      }
      if (stepOutput.reasoning) {
        cumulativeAssistantReasoning += (cumulativeAssistantReasoning ? '\n' : '') + stepOutput.reasoning
      }

      if (DEBUG_USAGE) {
        try {
          console.log('[LLMService] provider usage event', {
            provider: effectiveProvider,
            model: effectiveModel,
            usage,
            stepCategories: categories
          })
        } catch {}
      }

      // Calculate cost for this usage event
      let cost: any = undefined
      try {
        const settingsService = getSettingsService()
        const calculatedCost = settingsService.calculateCost(effectiveProvider, effectiveModel, usage as TokenUsage)
        if (calculatedCost) {
          cost = calculatedCost
        }
      } catch (err) {
        if (DEBUG_USAGE) {
          console.error('[LLMService] Failed to calculate cost:', err)
        }
      }

      // Emit the usage event so the UI can update in real-time
      try {
        emitUsage({ ...usage, cost })
      } catch (err) {
        if (DEBUG_USAGE) {
          console.error('[LLMService] Failed to emit usage event:', err)
        }
      }
    }

    const approxInputTokens = estimateInputTokens(effectiveProvider, formattedMessages)

    const {
      temperature: effectiveTemperature,
      reasoningEffort: effectiveReasoningEffort,
      includeThoughts,
      thinkingBudget: effectiveThinkingBudget,
      geminiCacheMode,
      geminiCacheRefreshThreshold
    } = resolveSamplingControls({
      provider: effectiveProvider,
      model: effectiveModel,
      workingContext,
      requestReasoningEffort,
    })

    let response = ''
    let reasoning = '' // Accumulate reasoning/thinking from provider

    try {
      // NOTE: This entire block must live inside an async function so that
      // we can legally use `await` for proactive rate limiting and streaming.
      // Ensure the containing method (`chat`) is declared `async`.
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
            const approxOutput = tokenCounter.count(response)
            usageAccumulator.emitBestEffortUsage(emitUsage, approxInputTokens, approxOutput)
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
            ...(includeThoughts ? { includeThoughts: true } : {}),
            ...(effectiveThinkingBudget !== undefined ? { thinkingBudget: effectiveThinkingBudget } : {}),
            // Gemini-specific: cache mode (explicit or implicit) and refresh threshold
            ...(geminiCacheMode ? { geminiCacheMode } : {}),
            ...(geminiCacheRefreshThreshold !== undefined ? { geminiCacheRefreshThreshold } : {}),
            // Callbacks that providers call - these are wrapped to emit ExecutionEvents
            onChunk: (text: string) => {
              if (!text) return
              if (process.env.HF_FLOW_DEBUG === '1') {
                try { console.log(`[llm-service] onChunk node=${flowAPI.nodeId} provider=${effectiveProvider}/${effectiveModel} len=${text?.length}`) } catch { }
              }
              // Trust providers to send clean deltas - no deduplication here.
              // If a provider sends duplicates, fix it at the provider level.
              response += text
              eventHandlers.onChunk(text)
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
          if (isAnthropicModel) {
            // Anthropic format (native Anthropic or OpenRouter+Claude): { system, messages }
            // System has cache_control markers for prompt caching
            streamOpts = {
              ...baseStreamOpts,
              system: formattedMessages.system,
              messages: formattedMessages.messages
            }
            // Capture for usage breakdown
            __bdSystemText = formattedMessages.system
            __bdMessages = formattedMessages.messages
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
            tools: hydratedTools
          })

          // Debug file logging for semantic tools investigation
          debugLog('LLM_REQUEST', {
            provider: effectiveProvider,
            model: effectiveModel,
            systemInstructions: typeof __bdSystemText === 'string'
              ? __bdSystemText
              : Array.isArray(__bdSystemText)
                ? __bdSystemText.map((b: any) => b?.text).join('\n')
                : undefined,
            messages: __bdMessages,
            toolDefinitions: hydratedTools?.map((t: any) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }))
          })

          // NOTE: Retry logic is handled at the provider level (per-step in agentic loop).
          // Service-level retry would restart the entire flow, losing progress from previous steps.
          const policyTools = (hydratedTools && hydratedTools.length)
            ? wrapToolsWithPolicy(hydratedTools, {
              // Disable dedupe for fsReadLines/fsReadFile to ensure RAW text is returned (no cached JSON stubs)
              dedupeReadLines: false,
              // Remove re-read limits for fsReadLines so LLMs can read, edit, then re-read to verify
              dedupeReadFile: false,
            })
            : []

          const agentStreamConfig = {
            ...streamOpts,
            tools: policyTools,
            responseSchema,
            toolMeta: {
              requestId: context.contextId,
              workspaceId: (flowAPI as any)?.workspaceId,
              flowAPI, // Pass FlowAPI so tools like askForInput can use it
            },
            onToolStart: onToolStartWrapped,
            onToolEnd: onToolEndWrapped,
            onToolError: eventHandlers.onToolError,
            onStep: onStepWrapped
          }

          if (process.env.HF_FLOW_DEBUG === '1') {
            try {
              const { apiKey: _apiKey, ...loggableConfig } = agentStreamConfig as any
              const logPayload = {
                provider: effectiveProvider,
                model: effectiveModel,
                config: loggableConfig
              }
              console.log(
                '[llm-service] agentStream config',
                inspect(logPayload, {
                  depth: null,
                  maxArrayLength: null,
                  breakLength: 120,
                  colors: false
                })
              )
            } catch {}
          }

          streamHandle = await providerAdapter.agentStream(agentStreamConfig)

          try { flowAPI.log.debug('llmService.chat agentStream started', { provider: effectiveProvider, model: effectiveModel }) } catch { }
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

      // Emit usage breakdown (general; precise when tokenizer available)
      // Handle system text - can be string or array of Anthropic blocks
      let systemTextForBreakdown = ''
      if (typeof __bdSystemText === 'string') {
        systemTextForBreakdown = __bdSystemText
      } else if (Array.isArray(__bdSystemText)) {
        systemTextForBreakdown = __bdSystemText.map((block: any) => block?.text || '').filter(Boolean).join('\n')
      }
      const instructionsTokens = tokenCounter.count(systemTextForBreakdown)
      let userMsgTokens = 0
      let assistantMsgTokens = 0
      if (Array.isArray(__bdMessages)) {
        for (const entry of __bdMessages) {
          const role = (entry && (entry as any).role) || ''
          const content = (entry && (entry as any).content) ?? ''
          const tokens = tokenCounter.count(typeof content === 'string' ? content : String(content))
          if (role === 'user') userMsgTokens += tokens
          else if (role === 'assistant') assistantMsgTokens += tokens
        }
      }

      const toolSnapshot = toolUsageTracker.getSnapshot()
      const toolDefinitionsTokens = tokenCounter.count(JSON.stringify(hydratedTools || []))
      const responseFormatTokens = tokenCounter.count(JSON.stringify(responseSchema || null))
      const toolCallResultsTokens = toolSnapshot.resultsTokensIn
      const assistantTextTokens = tokenCounter.count(response)
      const toolCallsTokens = toolSnapshot.argsTokensOut

      const calcInput = instructionsTokens + userMsgTokens + assistantMsgTokens + toolDefinitionsTokens + responseFormatTokens + toolCallResultsTokens
      const calcOutput = assistantTextTokens + toolCallsTokens

      const accumulatedTotals = usageAccumulator.getAccumulatedTotals()
      const hasAccum = (accumulatedTotals.inputTokens || 0) > 0 ||
        (accumulatedTotals.outputTokens || 0) > 0 ||
        (accumulatedTotals.totalTokens || 0) > 0
      const lastReported = usageAccumulator.getLastReportedUsage()

      // Token usage precedence:
      // 1) Accumulated provider-reported totals (most accurate, from multiple onTokenUsage callbacks)
      // 2) Last provider-reported usage (single callback, some providers only report once)
      // 3) Local estimates from tokenizer (fallback for providers without usage reporting)
      const totals = hasAccum
        ? {
          inputTokens: accumulatedTotals.inputTokens ?? calcInput,
          outputTokens: accumulatedTotals.outputTokens ?? calcOutput,
          totalTokens: accumulatedTotals.totalTokens ?? ((accumulatedTotals.inputTokens ?? calcInput) + (accumulatedTotals.outputTokens ?? calcOutput)),
          cachedTokens: Math.max(0, accumulatedTotals.cachedTokens || 0),
          reasoningTokens: accumulatedTotals.reasoningTokens || 0,
          stepCount: accumulatedTotals.stepCount || 0
        }
        : (lastReported
          ? {
            inputTokens: lastReported.inputTokens ?? calcInput,
            outputTokens: lastReported.outputTokens ?? calcOutput,
            totalTokens: lastReported.totalTokens ?? ((lastReported.inputTokens ?? calcInput) + (lastReported.outputTokens ?? calcOutput)),
            cachedTokens: Math.max(0, lastReported.cachedTokens || (lastReported as any).cachedInputTokens || 0),
            reasoningTokens: lastReported.reasoningTokens || 0,
            stepCount: lastReported.stepCount || 0
          }
          : { inputTokens: calcInput, outputTokens: calcOutput, totalTokens: calcInput + calcOutput, cachedTokens: 0, reasoningTokens: 0, stepCount: 0 })

      // Use explicitly reported reasoning tokens if available (from o1/o3 models),
      // otherwise fall back to delta calculation (output - text - tool calls)
      const thoughtsTokens = (totals.reasoningTokens || 0) > 0
        ? totals.reasoningTokens
        : Math.max(0, Number(totals.outputTokens || 0) - (assistantTextTokens + toolCallsTokens))

      const toolKeys = new Set([
        ...Object.keys(toolSnapshot.argsTokensByTool || {}),
        ...Object.keys(toolSnapshot.resultsTokensByTool || {})
      ])
      const toolsBreakdown = Object.fromEntries(
        Array.from(toolKeys).map((key) => [
          key,
          {
            calls: toolSnapshot.callsByTool[key] || 0,
            inputResults: toolSnapshot.resultsTokensByTool[key] || 0,
            outputArgs: toolSnapshot.argsTokensByTool[key] || 0
          }
        ])
      )

      // Get per-step breakdown for agentic requests
      const agenticBreakdown = usageAccumulator.getAgenticBreakdown()
      const hasPerStepData = agenticBreakdown.steps.length > 1

      try {
        flowAPI.log?.debug?.('LLMService.chat emitting usage_breakdown', {
          provider: effectiveProvider,
          model: effectiveModel,
          totals,
          hasAccum,
          calcInput,
          calcOutput,
          hasPerStepData,
          stepCount: agenticBreakdown.steps.length
        })
      } catch {}

      try {
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
            totals: { ...totals },
            estimated: !tokenCounter.precise,
            tools: toolsBreakdown,
            // Per-step breakdown for multi-step agentic requests
            perStep: hasPerStepData ? agenticBreakdown.steps.map(step => ({
              stepNumber: step.stepNumber,
              categories: step.categories,
              providerInputTokens: step.providerInputTokens,
              providerOutputTokens: step.providerOutputTokens,
              cachedTokens: step.cachedTokens,
              inputTotal: step.inputTotal,
              outputTotal: step.outputTotal
            })) : undefined,
            // Re-sent context summary
            resent: hasPerStepData ? agenticBreakdown.summary.resent : undefined,
            // Comparison of accumulated vs unique tokens
            comparison: hasPerStepData ? {
              accumulatedInput: agenticBreakdown.summary.accumulatedInput,
              uniqueInput: agenticBreakdown.summary.uniqueInput,
              accumulatedOutput: agenticBreakdown.summary.accumulatedOutput,
              uniqueOutput: agenticBreakdown.summary.uniqueOutput
            } : undefined
          }
        })
      } catch (e) {
        console.warn('[LLM] failed to emit usage_breakdown', e)
      }

      // 7. Context is now updated incrementally via onStepWrapped.
      // We no longer need to add the final response here as it was already added in the last step.

      return {
        text: response,
        reasoning: reasoning.trim() || undefined,
      }
    } catch (e: any) {
      const errorMessage = e.message || String(e)

      // Treat cancellations/terminations as non-errors for UI event emission
      const isCancellation = /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(errorMessage)
      if (!isCancellation) {
        // Send error event to UI only for real errors
        eventHandlers.onError(errorMessage)
      }

      return {
        text: response, // Return partial text on error
        reasoning: reasoning.trim() || undefined, // Return partial reasoning on error
        error: errorMessage
      }
    } finally {
      try {
        tokenCounter.dispose()
      } catch {}
    }
  }
}

// Singleton instance
export const llmService = new LLMService()

function normalizeUserMessageContent(value: unknown): string | import('./types').MessagePart[] {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value as import('./types').MessagePart[]
  return ''
}

function hydrateAgentTools(
  requested: Array<AgentTool | FlowTool> | undefined,
  workspaceId?: string | null
): { tools: AgentTool[]; missing: string[] } {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { tools: [], missing: [] }
  }

  const resolved: AgentTool[] = []
  const missing: string[] = []
  let registryByName: Map<string, AgentTool> | null = null

  const resolveFromRegistry = (name: string): AgentTool | undefined => {
    if (!registryByName) {
      const snapshot = getAgentToolSnapshot(workspaceId)
      registryByName = new Map(snapshot.map((tool) => [tool.name, tool]))
    }
    return registryByName ? registryByName.get(name) : undefined
  }

  for (const entry of requested) {
    if (!entry) continue
    if (typeof (entry as AgentTool).run === 'function') {
      resolved.push(entry as AgentTool)
      continue
    }

    const name = extractToolName(entry)
    if (!name) continue

    const match = resolveFromRegistry(name)
    if (match) {
      resolved.push(match)
    } else if (!missing.includes(name)) {
      missing.push(name)
    }
  }

  return { tools: resolved, missing }
}

function extractToolName(entry: AgentTool | FlowTool | string | undefined): string | null {
  if (!entry) return null
  if (typeof entry === 'string') {
    return entry || null
  }
  if (typeof (entry as FlowTool).name === 'string') {
    return (entry as FlowTool).name
  }
  return null
}

