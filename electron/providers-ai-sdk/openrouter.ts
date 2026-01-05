/**
 * OpenRouter provider using the native OpenAI SDK.
 *
 * OpenRouter is fully compatible with the OpenAI Chat Completions API,
 * so we use the official OpenAI SDK with a custom baseURL.
 * This is the approach OpenRouter officially recommends.
 */
import OpenAI from 'openai'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../src/store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool } from '../providers/provider'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionChunk } from 'openai/resources/chat/completions'

const DEBUG = true //= process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

function sanitizeName(name: string): string {
  let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!safe) safe = 'tool'
  return safe
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
  const nameMap = new Map<string, string>() // safe -> original
  const toolMap = new Map<string, AgentTool>() // safe -> tool

  for (const t of tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    if (nameMap.has(safe) && nameMap.get(safe) !== t.name) {
      if (DEBUG) console.warn('[openrouter] tool name collision', { safe, a: nameMap.get(safe), b: t.name })
    }
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
 * Convert our message format to OpenAI's ChatCompletionMessageParam.
 * Consolidates consecutive assistant messages into single messages
 * to maintain proper user/assistant alternation.
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
        // Check if last message is also assistant - if so, merge
        const lastMsg = result[result.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          // Merge content
          const existingContent = (lastMsg as any).content || ''
          const newContent = msg.content || ''
          if (existingContent && newContent) {
            (lastMsg as any).content = existingContent + '\n' + newContent
          } else if (newContent) {
            (lastMsg as any).content = newContent
          }
          // Merge reasoning_details (for continuation)
          if (Array.isArray(msg.reasoning_details)) {
            if (!Array.isArray((lastMsg as any).reasoning_details)) {
              (lastMsg as any).reasoning_details = []
            }
            (lastMsg as any).reasoning_details.push(...msg.reasoning_details)
          }
      } else {
        // New assistant message
        const assistantMsg: any = { role: 'assistant', content: msg.content || null }
        // Preserve reasoning_details for continuation
        if (Array.isArray(msg.reasoning_details)) {
          assistantMsg.reasoning_details = msg.reasoning_details
        }
        result.push(assistantMsg)
      }
    } else if (msg.role === 'tool') {
      // Skip tool result messages from history (tool results are only added for current turn in agent loop)
      // This prevents orphaned tool results when tool_calls are not persisted
    }
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
    const debugThis = DEBUG

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

    // Build initial messages
    let conversationMessages = toOpenAIMessages(system, messages || [])

    // Agentic loop - continue until no more tool calls
    let stepCount = 0
    let cancelled = false

    // Accumulate across ALL steps for consolidated reporting
    // This gives us user/assistant pairs instead of multiple assistant messages
    let turnText = ''
    let turnReasoning = ''
    const turnToolCalls: Array<{ toolCallId: string; toolName: string; args: any }> = []
    const turnToolResults: Array<{ toolCallId: string; toolName: string; result: any }> = []

    const runLoop = async () => {
      try {
        if (debugThis) {
          console.log('[openrouter] starting loop', {
            model,
            initialMessages: conversationMessages.length,
            tools: openaiTools.length,
            firstMessage: JSON.stringify(conversationMessages[0]).slice(0, 200),
            lastMessage: JSON.stringify(conversationMessages[conversationMessages.length - 1]).slice(0, 200)
          })
        }

        while (stepCount < AGENT_MAX_STEPS && !cancelled) {
          stepCount++

          if (debugThis) {
            console.log(`[openrouter] step ${stepCount}`, {
              model,
              messages: conversationMessages.length,
              tools: openaiTools.length
            })
          }

          // Make streaming request
          // Include reasoning: { enabled: true } for models that support extended thinking
          const requestBody: any = {
            model,
            messages: conversationMessages,
            tools: hasTools ? openaiTools : undefined,
            tool_choice: hasTools ? 'auto' : undefined,
            temperature: typeof temperature === 'number' ? temperature : undefined,
            stream: true,
            // OpenRouter extension for reasoning models
            reasoning: { enabled: true }
          }
          const stream = await client.chat.completions.create(requestBody, { signal: ac.signal })

          // Accumulate response data for this step
          let stepText = ''
          let stepReasoning = ''
          let reasoningDetails: any[] = []
          const toolCalls: Map<number, { id: string; name: string; arguments: string; thoughtSignature?: string }> = new Map()
          let finishReason: string | null = null
          let usage: any = null

          // Process stream - cast to AsyncIterable since TS loses type info due to `any` requestBody
          for await (const chunk of stream as unknown as AsyncIterable<ChatCompletionChunk>) {
            if (cancelled) break

            const choice = chunk.choices?.[0]
            if (!choice) continue

            const delta = choice.delta as any

            // Stream text in real-time
            if (delta?.content) {
              stepText += delta.content
              onTextChunk?.(delta.content)
            }

            // Stream reasoning in real-time and accumulate
            if (delta?.reasoning) {
              stepReasoning += delta.reasoning
              emit?.({ type: 'reasoning', provider: 'openrouter', model, reasoning: delta.reasoning })
            }

            // Accumulate reasoning_details for continuation
            if (Array.isArray(delta?.reasoning_details)) {
              reasoningDetails.push(...delta.reasoning_details)
            }

            // Accumulate tool calls (including thought signatures for Gemini 3)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: '', name: '', arguments: '', thoughtSignature: undefined as string | undefined })
                }
                const pending = toolCalls.get(idx)!
                if (tc.id) pending.id = tc.id
                if (tc.function?.name) pending.name = tc.function.name
                if (tc.function?.arguments) pending.arguments += tc.function.arguments
                // Capture thought signature for Gemini 3 (OpenAI compat format)
                const sig = (tc as any)?.extra_content?.google?.thought_signature
                if (sig) pending.thoughtSignature = sig
              }
            }

            if (choice.finish_reason) {
              finishReason = choice.finish_reason
            }

            if (chunk.usage) {
              usage = chunk.usage
            }
          }

          // Report usage
          if (usage && onTokenUsage) {
            onTokenUsage({
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0
            })
          }

          const toolCallsArray = Array.from(toolCalls.values()).filter(tc => tc.id && tc.name)

          // Accumulate into turn-level data (for consolidated reporting)
          if (stepText) {
            turnText += (turnText ? '\n' : '') + stepText
          }
          if (stepReasoning) {
            turnReasoning += (turnReasoning ? '\n' : '') + stepReasoning
          }

          if (debugThis) {
            console.log(`[openrouter] step ${stepCount} complete`, {
              finishReason,
              textLength: stepText.length,
              toolCalls: toolCallsArray.length,
              hasReasoningDetails: reasoningDetails.length > 0
            })
          }

          // If no tool calls, we're done
          if (toolCallsArray.length === 0 || finishReason !== 'tool_calls') {
            break
          }

          // Build assistant message for API conversation history
          // Include thought signatures for Gemini 3 (required for tool calls)
          const assistantMessage: any = {
            role: 'assistant',
            content: stepText || null,
            tool_calls: toolCallsArray.map(tc => {
              const toolCall: any = {
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments }
              }
              // Gemini 3 thought signatures (only on first tool call for parallel, on each for sequential)
              if (tc.thoughtSignature) {
                toolCall.extra_content = {
                  google: { thought_signature: tc.thoughtSignature }
                }
              }
              return toolCall
            })
          }
          // Preserve reasoning_details for continuation (per OpenRouter docs)
          if (reasoningDetails.length > 0) {
            assistantMessage.reasoning_details = reasoningDetails
          }
          conversationMessages.push(assistantMessage)

          // Execute each tool and add results
          for (const tc of toolCallsArray) {
            const originalName = nameMap.get(tc.name) || tc.name
            const tool = toolMap.get(tc.name)

            let args: any = {}
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {}
            } catch {}

            // Add to turn-level tool calls
            turnToolCalls.push({
              toolCallId: tc.id,
              toolName: originalName,
              args
            })

            // Notify tool start
            onToolStart?.({ callId: tc.id, name: originalName, arguments: args })

            if (!tool) {
              const errorResult = { error: `Tool not found: ${originalName}` }
              onToolError?.({ callId: tc.id, name: originalName, error: 'Tool not found' })
              turnToolResults.push({ toolCallId: tc.id, toolName: originalName, result: errorResult })
              conversationMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(errorResult)
              })
              continue
            }

            try {
              // Execute tool
              const raw = await tool.run(args, toolMeta)

              // Handle toModelResult pattern
              let toolResult = raw
              try {
                const toModel = (tool as any).toModelResult
                if (typeof toModel === 'function') {
                  const res = await toModel(raw)
                  if (res?.ui && res?.previewKey) {
                    UiPayloadCache.put(res.previewKey, res.ui)
                  }
                  toolResult = res?.minimal ?? raw
                }
              } catch {}

              // Notify tool end
              onToolEnd?.({ callId: tc.id, name: originalName, result: toolResult })

              // Add to turn-level tool results
              turnToolResults.push({ toolCallId: tc.id, toolName: originalName, result: toolResult })

              // Add tool result to API conversation
              const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
              conversationMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: resultStr
              })

            } catch (err: any) {
              const errorMessage = String(err?.message || err || 'Tool execution error')
              const errorResult = { error: errorMessage }
              onToolError?.({ callId: tc.id, name: originalName, error: errorMessage })
              turnToolResults.push({ toolCallId: tc.id, toolName: originalName, result: errorResult })
              conversationMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(errorResult)
              })
            }
          }

          // Continue loop for next step
        }

        // Report ONE consolidated step for the entire turn (user/assistant pair)
        if (onStep) {
          onStep({
            text: turnText,
            reasoning: turnReasoning || undefined,
            toolCalls: turnToolCalls,
            toolResults: turnToolResults
          })
        }

        // Done
        onStreamDone?.()

      } catch (err: any) {
        if (err.name === 'AbortError' || cancelled) {
          onStreamDone?.()
          return
        }
        console.error('[openrouter] error:', err)
        onStreamError?.(String(err?.message || err))
      }
    }

    // Start the loop
    runLoop()

    return {
      cancel: () => {
        cancelled = true
        try { ac.abort() } catch {}
      }
    }
  }
}
