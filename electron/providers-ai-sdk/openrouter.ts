/**
 * OpenRouter provider using the native OpenAI SDK.
 *
 * OpenRouter is fully compatible with the OpenAI Chat Completions API,
 * so we use the official OpenAI SDK with a custom baseURL.
 * This is the approach OpenRouter officially recommends.
 *
 * Simple implementation: no reasoning/tool calls persisted to session.
 *
 * Gemini 3 Thought Signatures:
 * When using Gemini 3 models via OpenRouter, thought signatures must be captured
 * from streaming responses and passed back in subsequent requests within the same
 * turn. This is required for Gemini 3's multi-step function calling to work.
 * The signature appears in extra_content.google.thought_signature.
 */
import OpenAI from 'openai'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../src/store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool } from '../providers/provider'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionChunk } from 'openai/resources/chat/completions'

function sanitizeName(name: string): string {
  return (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool'
}

/**
 * Build OpenAI-format tools from AgentTool array
 */
function buildOpenAITools(tools: AgentTool[] | undefined): {
  openaiTools: ChatCompletionTool[]
  nameMap: Map<string, string>
  toolMap: Map<string, AgentTool>
} {
  const openaiTools: ChatCompletionTool[] = []
  const nameMap = new Map<string, string>()
  const toolMap = new Map<string, AgentTool>()

  for (const t of tools || []) {
    if (!t?.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    nameMap.set(safe, t.name)
    toolMap.set(safe, t)

    openaiTools.push({
      type: 'function',
      function: {
        name: safe,
        description: t.description || undefined,
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    })
  }

  return { openaiTools, nameMap, toolMap }
}

/**
 * Convert session messages to OpenAI format.
 * Simple: just user and assistant text content.
 */
function toOpenAIMessages(
  system: string | undefined,
  messages: any[]
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = []

  if (system) {
    result.push({ role: 'system', content: system })
  }

  for (const msg of messages || []) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      // Merge consecutive assistant messages
      const last = result[result.length - 1]
      if (last?.role === 'assistant' && typeof last.content === 'string') {
        last.content = (last.content || '') + '\n' + (msg.content || '')
      } else {
        result.push({ role: 'assistant', content: msg.content || '' })
      }
    }
    // Skip tool messages - not persisted to session
  }

  return result
}

export const OpenRouterProvider: ProviderAdapter = {
  id: 'openrouter',

  async agentStream({
    apiKey,
    model,
    system,
    messages,
    temperature,
    tools,
    emit,
    onChunk: onTextChunk,
    onDone: onStreamDone,
    onError: onStreamError,
    onTokenUsage,
    toolMeta,
    onToolStart,
    onToolEnd,
    onToolError,
    onStep
  }): Promise<StreamHandle> {
    const ac = new AbortController()

    // Create OpenAI client pointing to OpenRouter
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://hifide.app',
        'X-Title': 'HiFide'
      }
    })

    const { openaiTools, nameMap, toolMap } = buildOpenAITools(tools)
    const hasTools = openaiTools.length > 0

    // Build messages for this request only (not persisted)
    let conversationMessages = toOpenAIMessages(system, messages || [])

    let stepCount = 0
    let cancelled = false

    // Accumulate text and reasoning across steps for consolidated reporting
    // Note: Tool calls/results are NOT accumulated for onStep - they are handled
    // within this provider's loop and should not be persisted to session history
    let turnText = ''
    let turnReasoning = ''

    const runLoop = async () => {
      try {
        while (stepCount < AGENT_MAX_STEPS && !cancelled) {
          stepCount++

          const requestBody: any = {
            model,
            messages: conversationMessages,
            tools: hasTools ? openaiTools : undefined,
            tool_choice: hasTools ? 'auto' : undefined,
            temperature: typeof temperature === 'number' ? temperature : undefined,
            stream: true,
            reasoning: { enabled: true }
          }

          const stream = await client.chat.completions.create(requestBody, { signal: ac.signal })

          let stepText = ''
          let stepReasoning = ''
          const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
          let finishReason: string | null = null
          let usage: any = null
          // Gemini 3 thought signature - required for multi-step function calling
          let thoughtSignature: string | undefined = undefined

          for await (const chunk of stream as unknown as AsyncIterable<ChatCompletionChunk>) {
            if (cancelled) break

            const choice = chunk.choices?.[0]
            if (!choice) continue
            //console.log(choice.delta)

            const delta = choice.delta as any

            if (delta?.content) {
              stepText += delta.content
              onTextChunk?.(delta.content)
            }

            if (delta?.reasoning) {
              stepReasoning += delta.reasoning
              emit?.({ type: 'reasoning', provider: 'openrouter', model, reasoning: delta.reasoning })
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: '', name: '', arguments: '' })
                }
                const pending = toolCalls.get(idx)!
                if (tc.id) pending.id = tc.id
                if (tc.function?.name) pending.name = tc.function.name
                if (tc.function?.arguments) pending.arguments += tc.function.arguments
              }
            }

            // Capture Gemini 3 thought signature from extra_content
            // This is required for Gemini 3 models during multi-step function calling
            const chunkAny = chunk as any
            if (chunkAny?.extra_content?.google?.thought_signature) {
              thoughtSignature = chunkAny.extra_content.google.thought_signature
            }

            if (choice.finish_reason) finishReason = choice.finish_reason
            if (chunk.usage) usage = chunk.usage
          }

          if (usage && onTokenUsage) {
            onTokenUsage({
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0
            })
          }

          const toolCallsArray = Array.from(toolCalls.values()).filter(tc => tc.id && tc.name)

          if (stepText) turnText += (turnText ? '\n' : '') + stepText
          if (stepReasoning) turnReasoning += (turnReasoning ? '\n' : '') + stepReasoning

          // No tool calls = done
          if (toolCallsArray.length === 0 || finishReason !== 'tool_calls') {
            break
          }

          // Add assistant message to local conversation (for this turn only)
          // Include Gemini 3 thought signature if present - required for multi-step function calling
          const assistantMessage: any = {
            role: 'assistant',
            content: stepText || null,
            tool_calls: toolCallsArray.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments }
            }))
          }
          // Add thought signature for Gemini 3 models
          if (thoughtSignature) {
            assistantMessage.extra_content = {
              google: { thought_signature: thoughtSignature }
            }
          }
          conversationMessages.push(assistantMessage)
          console.log(assistantMessage)

          // Execute tools and add results to local conversation (for this turn's API context only)
          for (const tc of toolCallsArray) {
            const originalName = nameMap.get(tc.name) || tc.name
            const tool = toolMap.get(tc.name)

            let args: any = {}
            try { args = tc.arguments ? JSON.parse(tc.arguments) : {} } catch {}

            onToolStart?.({ callId: tc.id, name: originalName, arguments: args })

            if (!tool) {
              const err = { error: `Tool not found: ${originalName}` }
              onToolError?.({ callId: tc.id, name: originalName, error: 'Tool not found' })
              conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(err) })
              continue
            }

            try {
              const raw = await tool.run(args, toolMeta)

              let toolResult = raw
              try {
                const toModel = (tool as any).toModelResult
                if (typeof toModel === 'function') {
                  const res = await toModel(raw)
                  if (res?.ui && res?.previewKey) UiPayloadCache.put(res.previewKey, res.ui)
                  toolResult = res?.minimal ?? raw
                }
              } catch {}

              onToolEnd?.({ callId: tc.id, name: originalName, result: toolResult })

              const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
              conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr })

            } catch (err: any) {
              const errorMessage = String(err?.message || err || 'Tool execution error')
              onToolError?.({ callId: tc.id, name: originalName, error: errorMessage })
              conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: errorMessage }) })
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

      } catch (err: any) {
        if (err.name === 'AbortError' || cancelled) {
          onStreamDone?.()
          return
        }
        onStreamError?.(String(err?.message || err))
      }
    }

    runLoop()

    return {
      cancel: () => {
        cancelled = true
        try { ac.abort() } catch {}
      }
    }
  }
}
