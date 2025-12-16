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
import type { FlowAPI, Tool as FlowTool } from './flow-api'
import type { ContextManager } from './contextManager'
import type { AgentTool, ProviderAdapter } from '../providers/provider'

import { inspect } from 'util'

import { getProviderKey, providers } from '../core/state'
import { getAgentToolSnapshot } from '../tools/agentToolRegistry.js'
import { createCallbackEventEmitters } from './execution-events'
import { rateLimitTracker } from '../providers/rate-limit-tracker'
import { parseRateLimitError, sleep, withRetries } from '../providers/retry'
import {
  estimateInputTokens,
  formatMessagesForAnthropic,
  formatMessagesForGemini,
  formatMessagesForOpenAI,
  logLLMRequestPayload,
} from './llm/payloads'

import { createTokenCounter, ToolUsageTracker, UsageAccumulator } from './llm/usage-tracker'
import { resolveSamplingControls } from './llm/stream-options'
import { wrapToolsWithPolicy } from './llm/tool-policy'

const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'




/**
 * Request to the LLM service
 */
export interface LLMServiceRequest {
  /** User message to send */
  message: string

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
      const alreadyAppended =
        !!lastEntry &&
        lastEntry.role === 'user' &&
        normalizedIncoming.length > 0 &&
        normalizedIncoming === normalizedLast

      if (!alreadyAppended) {
        const contentToStore = normalizedIncoming || message
        contextManager.addMessage({ role: 'user', content: contentToStore })
      }

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
        const systemText = request.systemInstructions ?? context.systemInstructions ?? ''
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
          systemInstruction: request.systemInstructions ?? context.systemInstructions ?? '',
          contents: [{ role: 'user', parts: [{ text: message }] }]
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
	  const latestContext = workingContext
	  if (effectiveProvider === 'anthropic') {
	    formattedMessages = formatMessagesForAnthropic(latestContext)
	  } else if (effectiveProvider === 'gemini') {
	    formattedMessages = formatMessagesForGemini(latestContext)
	  } else {
        formattedMessages = formatMessagesForOpenAI(latestContext, { provider: effectiveProvider })
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


    let __bdSystemText: string | undefined
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
      try { toolUsageTracker.handleToolStart(ev) } catch {}
      eventHandlers.onToolStart(ev)
    }
    const onToolEndWrapped = (ev: { callId?: string; name: string; result?: any }) => {
      try { toolUsageTracker.handleToolEnd(ev) } catch {}
      eventHandlers.onToolEnd(ev as any)
    }

    const onTokenUsageWrapped = (usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number }) => {
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

      try {
        console.log('[LLMService] provider usage event', {
          provider: effectiveProvider,
          model: effectiveModel,
          usage,
        })
      } catch {}
    }

    const approxInputTokens = estimateInputTokens(effectiveProvider, formattedMessages)

    const {
      temperature: effectiveTemperature,
      reasoningEffort: effectiveReasoningEffort,
      includeThoughts,
      thinkingBudget: effectiveThinkingBudget
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
            tools: hydratedTools
          })

          // Wrap provider call with retry logic
          await withRetries(
            async () => {
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
                toolMeta: { requestId: context.contextId, workspaceId: (flowAPI as any)?.workspaceId }, // Include workspace for tool scoping
                onToolStart: onToolStartWrapped,
                onToolEnd: onToolEndWrapped,
                onToolError: eventHandlers.onToolError
              }

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

              streamHandle = await providerAdapter.agentStream(agentStreamConfig)

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

      // Emit usage breakdown (general; precise when tokenizer available)
      const instructionsTokens = tokenCounter.count(__bdSystemText || '')
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

      const totals = hasAccum
        ? {
          inputTokens: accumulatedTotals.inputTokens ?? calcInput,
          outputTokens: accumulatedTotals.outputTokens ?? calcOutput,
          totalTokens: accumulatedTotals.totalTokens ?? ((accumulatedTotals.inputTokens ?? calcInput) + (accumulatedTotals.outputTokens ?? calcOutput)),
          cachedTokens: Math.max(0, accumulatedTotals.cachedTokens || 0)
        }
        : (lastReported
          ? {
            inputTokens: lastReported.inputTokens ?? calcInput,
            outputTokens: lastReported.outputTokens ?? calcOutput,
            totalTokens: lastReported.totalTokens ?? ((lastReported.inputTokens ?? calcInput) + (lastReported.outputTokens ?? calcOutput)),
            cachedTokens: Math.max(0, lastReported.cachedTokens || (lastReported as any).cachedInputTokens || 0)
          }
          : { inputTokens: calcInput, outputTokens: calcOutput, totalTokens: calcInput + calcOutput, cachedTokens: 0 })

      const thoughtsTokens = Math.max(0, Number(totals.outputTokens || 0) - (assistantTextTokens + toolCallsTokens))

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

      try {
        flowAPI.log?.debug?.('LLMService.chat emitting usage_breakdown', {
          provider: effectiveProvider,
          model: effectiveModel,
          totals,
          hasAccum,
          calcInput,
          calcOutput
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
            tools: toolsBreakdown
          }
        })
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
    } catch (e: any) {
      const errorMessage = e.message || String(e)

      // Treat cancellations/terminations as non-errors for UI event emission
      const isCancellation = /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(errorMessage)
      if (!isCancellation) {
        // Send error event to UI only for real errors
        eventHandlers.onError(errorMessage)
      }

      return {
        text: '',
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

function normalizeUserMessageContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

