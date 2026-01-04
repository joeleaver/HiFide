import { tool, fromChatMessages, toChatMessage } from '@openrouter/sdk'
import { z } from 'zod'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../src/store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool } from '../providers/provider'

function sanitizeName(name: string): string {
  let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!safe) safe = 'tool'
  return safe
}

/**
 * Build OpenRouter SDK tools from AgentTool array
 * Handles name sanitization and Zod schema validation
 */
function buildOpenRouterTools(tools: AgentTool[] | undefined, meta?: { requestId?: string; [k: string]: any }) {
  const sdkTools: any[] = []
  const nameMap = new Map<string, string>() // safe -> original

  for (const t of tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') continue

    const safe = sanitizeName(t.name)
    
    // Detect and warn about name collisions
    if (nameMap.has(safe) && nameMap.get(safe) !== t.name) {
      const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'
      if (DEBUG) {
        console.warn('[openrouter:sdk] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
      }
    }
    nameMap.set(safe, t.name)

    // Build input schema using tool's declared JSON Schema
    const inputSchema = t.parameters && typeof t.parameters === 'object' 
      ? z.object(t.parameters)
      : z.any()

    // Create tool with execute function that handles toModelResult pattern
    const sdkTool = tool({
      name: safe,
      description: t.description || undefined,
      inputSchema,
      execute: async (input: any, context: any) => {
        try {
          // Execute the tool
          const raw = await t.run(input, meta)

          // Handle toModelResult pattern for reducing tokens
          const toModel = (t as any).toModelResult
          if (typeof toModel === 'function') {
            const res = await toModel(raw)
            if (res && (res as any).ui && (res as any).previewKey) {
              UiPayloadCache.put((res as any).previewKey, (res as any).ui)
            }
            return (res as any)?.minimal ?? raw
          }
        } catch (err: any) {
          // If toModelResult fails, return raw result
          if (process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1') {
            console.error('[openrouter:sdk] toModelResult error', err)
          }
          return raw
        }

        return raw
      }
    })

    sdkTools.push(sdkTool)
  }

  return { tools: sdkTools, nameMap }
}

/**
 * Convert our ChatMessage format to OpenRouter-compatible format
 * Handles multi-modal content (text + images)
 */
function convertMessagesToOpenRouter(messages?: any[]): any[] {
  if (!messages) return []

  return messages.map((msg: any) => {
    // Handle string content
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content
      }
    }

    // Handle multi-modal content (array of parts)
    if (Array.isArray(msg.content)) {
      const parts = msg.content.map((part: any) => {
        // Text part
        if (part.type === 'text') {
          return { type: 'text', text: part.text }
        }

        // Image part - convert to image_url format for OpenRouter
        if (part.type === 'image') {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${part.mimeType};base64,${part.image}`
            }
          }
        }

        // Unknown part type
        return { type: 'text', text: String(part.text || '') }
      })

      return {
        role: msg.role,
        content: parts
      }
    }

    // Fallback for unknown content type
    return {
      role: msg.role,
      content: msg.content
    }
  })
}

/**
 * Normalize token usage from OpenRouter response
 * Handles provider-specific field naming
 */
function normalizeUsage(usage: any): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens?: number
} {
  const u = usage || {}

  return {
    inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0),
    totalTokens: Number(u.totalTokens ?? (Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0))),
    cachedTokens: Number(u.cachedInputTokens ?? u.cachedTokens ?? 0),
    reasoningTokens: Number(u.reasoningTokens ?? 0)
  }
}

/**
 * Detect if model supports extended thinking (reasoning)
 */
function supportsReasoning(model: string): boolean {
  // Claude 4.x, 3.7 Sonnet, 3.5 Sonnet
  if (/claude-4/i.test(model) || /claude-3-7-sonnet/i.test(model) || /claude-3\.5/i.test(model)) {
    return true
  }
  
  // OpenAI o1/o3 series
  if (/^o1-|^o3-/.test(model)) {
    return true
  }

  // DeepSeek reasoning models via OpenRouter
  if (/deepseek.*r1|reasoning/i.test(model)) {
    return true
  }

  // Other models that explicitly advertise reasoning
  if (/reasoning|thinking|extended/i.test(model)) {
    return true
  }

  return false
}

/**
 * OpenRouter Provider using @openrouter/sdk
 * Implements ProviderAdapter with native OpenRouter SDK integration
 */
export const OpenRouterProvider: ProviderAdapter = {
  id: 'openrouter',

  async agentStream({ 
    apiKey, 
    model, 
    system, 
    messages, 
    temperature, 
    reasoningEffort,
    includeThoughts,
    thinkingBudget,
    tools, 
    responseSchema: _responseSchema,
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
    const { tools: sdkTools, nameMap } = buildOpenRouterTools(tools, toolMeta)
    const ac = new AbortController()
    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[openrouter:sdk] agentStream start', { 
          model, 
          msgs: messages?.length || 0, 
          tools: sdkTools.length,
          includeThoughts,
          thinkingBudget,
          reasoningEffort
        })
      }

      // Initialize OpenRouter SDK
      const { OpenRouter } = await import('@openrouter/sdk')
      const openrouter = new OpenRouter({ apiKey })

      // Use SDK's fromChatMessages helper for proper conversation format
      // This ensures proper message alternation and format compatibility
      const input = messages && messages.length > 0 ? fromChatMessages(messages) : messages?.[0]?.content || ''

      // Determine if tools should be enabled
      const hasTools = sdkTools.length > 0
      const toolChoice = hasTools ? 'auto' : 'none'

      // Enable reasoning for supported models
      const shouldEnableReasoning = includeThoughts === true && supportsReasoning(model)
      const inputConfig: any = {
        model,
        input,
        instructions: system, // Pass system instructions via SDK's instructions parameter
        tools: hasTools ? sdkTools : undefined,
        toolChoice
      }

      // Add reasoning configuration for supported models
      if (shouldEnableReasoning) {
        // OpenAI o1/o3 models use reasoningEffort
        if (/^o1-|^o3-/.test(model)) {
          if (reasoningEffort && reasoningEffort !== 'medium') {
            inputConfig.providerOptions = {
              openai: {
                reasoning_effort: reasoningEffort as 'low' | 'medium' | 'high'
              }
            }
          } else if (reasoningEffort === 'medium') {
            // Default for o1/o3 if not specified
            inputConfig.providerOptions = {
              openai: {
                reasoning_effort: 'medium'
              }
            }
          }
        } 
        // Anthropic Claude models use thinking budget
        else if (/claude/i.test(model)) {
          if (typeof thinkingBudget === 'number' && thinkingBudget > 0) {
            inputConfig.providerOptions = {
              anthropic: {
                thinking: {
                  type: 'enabled',
                  budgetTokens: thinkingBudget
                }
              }
            }
          }
        }
        // DeepSeek/Fireworks reasoning via <think> tags
        else if (/deepseek/i.test(model) || /reasoning/i.test(model)) {
          // Reasoning is embedded in response via <think> tags
          // No special config needed, SDK will extract automatically
        }
      }

      if (DEBUG) {
        console.log('[openrouter:sdk] callModel config', inputConfig)
      }

      // Call the model
      const result = openrouter.callModel(inputConfig)

      // === STREAM TEXT ===
      for await (const delta of result.getTextStream()) {
        if (delta) {
          onTextChunk?.(delta)
        }
      }

      // === STREAM REASONING ===
      for await (const delta of result.getReasoningStream()) {
        if (delta) {
          // Emit reasoning via separate event, not onChunk
          emit?.({ 
            type: 'reasoning', 
            provider: 'openrouter', 
            model, 
            reasoning: delta 
          })
        }
      }

      // === STREAM TOOL CALLS ===
      // Track which tool calls we've seen to avoid duplicates
      const seenToolCallIds = new Set<string>()

      // Stream tool events using getToolStream
      for await (const event of result.getToolStream()) {
        if (DEBUG) {
          console.log('[openrouter:sdk] tool event', event)
        }

        switch (event.type) {
          case 'delta': {
            // Argument delta (streaming tool arguments)
            // This is handled by tool call completion
            break
          }

          case 'preliminary_result': {
            // Progress update from generator tools
            // We could emit progress events here if desired
            break
          }

          case 'call': {
            // Tool call completed (with full arguments)
            const callId = event.toolCallId || event.id || ''
            if (!callId || seenToolCallIds.has(callId)) break

            seenToolCallIds.add(callId)
            const safeName = String(event.toolName || '')
            const originalName = nameMap.get(safeName) || safeName

            onToolStart?.({ 
              callId, 
              name: originalName, 
              arguments: event.arguments 
            })
            break
          }

          case 'result': {
            // Tool execution result
            const callId = event.toolCallId || ''
            if (!callId) break

            const safeName = String(event.toolName || '')
            const originalName = nameMap.get(safeName) || safeName

            // Parse output if it's stringified JSON
            let output: any = event.output
            if (typeof output === 'string') {
              try {
                const trimmed = output.trim()
                if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
                    (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                  output = JSON.parse(trimmed)
                }
              } catch (err: any) {
                // Keep as string if parsing fails
              }
            }

            onToolEnd?.({ 
              callId, 
              name: originalName, 
              result: output 
            })
            break
          }

          case 'error': {
            // Tool execution error
            const callId = event.toolCallId || ''
            if (!callId) break

            const safeName = String(event.toolName || '')
            const originalName = nameMap.get(safeName) || safeName

            const errorMessage = String(event.error?.message || event.error || 'tool error')
            onToolError?.({ 
              callId, 
              name: originalName, 
              error: errorMessage 
            })
            break
          }
        }
      }

      // === STEP COMPLETION (when using streaming) ===
      // Use getResponse to get final usage and full response
      const response = await result.getResponse()

      if (DEBUG) {
        console.log('[openrouter:sdk] onStepFinish/finish', { 
          usage: response.usage,
          finishReason: response.finishReason
        })
      }

      // Emit step completion with all data
      if (onStep) {
        onStep({
          text: response.text || '',
          reasoning: response.reasoning || undefined,
          toolCalls: response.toolCalls || [],
          toolResults: response.toolResults || []
        })
      }

      // Report token usage
      if (response.usage && onTokenUsage) {
        const usage = normalizeUsage(response.usage)
        onTokenUsage(usage)
      }

      // Emit completion
      onStreamDone?.()

      return {
        cancel: () => {
          try {
            ac.abort()
            if (DEBUG) {
              console.log('[openrouter:sdk] cancelled')
            }
          } catch (err: any) {
            if (DEBUG) {
              console.error('[openrouter:sdk] cancel error', err)
            }
          }
        }
      }

    } catch (err: any) {
      const errorMessage = String(err?.message || err || 'OpenRouter provider error')
      
      if (DEBUG) {
        console.error('[openrouter:sdk] adapter exception', err)
      }

      onStreamError?.(errorMessage)

      return {
        cancel: () => {
          // Nothing to cancel if setup failed
        }
      }
    }
  }
}
