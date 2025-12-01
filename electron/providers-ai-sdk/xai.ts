import { streamText, tool as aiTool, stepCountIs, jsonSchema } from 'ai'
import { createXai } from '@ai-sdk/xai'
import { z } from 'zod'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../src/store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool } from '../providers/provider'

function sanitizeName(name: string): string {
  let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!safe) safe = 'tool'
  return safe
}

function buildAiSdkTools(tools: AgentTool[] | undefined, meta?: { requestId?: string; [k: string]: any }) {
  const map: Record<string, any> = {}
  const nameMap = new Map<string, string>() // safe -> original
  for (const t of tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    if (nameMap.has(safe) && nameMap.get(safe) !== t.name) {
      const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'
      if (DEBUG) console.warn('[ai-sdk:xai] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
    }
    nameMap.set(safe, t.name)
    // Prefer the tool's declared JSON Schema; fallback to permissive schema
    const inputSchema = t.parameters && typeof t.parameters === 'object' ? jsonSchema(t.parameters) : z.any()
    map[safe] = aiTool<any, any>({
      description: t.description || undefined,
      inputSchema,
      execute: async (input: any) => {
        const raw = await t.run(input, meta)
        try {
          const toModel = (t as any).toModelResult
          if (typeof toModel === 'function') {
            const res = await toModel(raw)
            if (res && (res as any).ui && (res as any).previewKey) {
              UiPayloadCache.put((res as any).previewKey, (res as any).ui)
            }
            return (res as any)?.minimal ?? raw
          }
        } catch {}
        return raw
      }
    })
  }
  return { tools: map, nameMap }
}

// We intentionally avoid ad-hoc text sanitization. Text emission is gated by
// AI SDK step boundaries to avoid surfacing provider-specific artifacts that may
// appear during tool-call steps.

export const XaiAiSdkProvider: ProviderAdapter = {
  id: 'xai',

  async agentStream({ apiKey, model, system, messages, temperature, tools, responseSchema: _responseSchema, emit: _emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const xai = createXai({ apiKey })
    const llm = xai(model)

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    // Expect system to be provided top-level (string) and messages without system-role
    const systemText: string | undefined = typeof system === 'string' ? system : undefined
    const msgs = (messages || []) as any

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    // Buffer text per step; only emit if the step has no tool calls
    const hasTools = Object.keys(aiTools).length > 0
    let pendingText = ''

    try {
      if (DEBUG) {
        console.log('[ai-sdk:xai] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      const result = streamText({
        model: llm,
        system: systemText,
        messages: msgs as any,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        parallelToolCalls: false,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        // Note: do NOT forward reasoningEffort; xAI currently does not require it here
        abortSignal: ac.signal,
        stopWhen: stepCountIs(AGENT_MAX_STEPS),
        includeRawChunks: DEBUG,
        // Stream mapping (AI SDK v5 onChunk passes { chunk })
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
              const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
              console.log('[ai-sdk:xai] onChunk', { type: chunk.type, tool: (chunk as any).toolName, brief })
            }
            switch (chunk.type) {
              case 'text-delta': {
                const d = chunk.text || ''
                if (!d) break
                if (hasTools) {
                  // Buffer text until we know whether this step used tools
                  pendingText += d
                } else {
                  onTextChunk?.(d)
                }
                break
              }
              case 'tool-input-start': {
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId) {
                  const args = (chunk as any).input
                  if (args !== undefined) {
                    const safe = String(chunk.toolName || '')
                    const original = nameMap.get(safe) || safe
                    onToolStart?.({ callId, name: original, arguments: args })
                    seenStarts.add(callId)
                  }
                }
                break
              }
              case 'tool-input-delta': {
                // Ignore deltas; wait for 'tool-call' which includes full arguments.
                break
              }
              case 'tool-call': {
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId) {
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original, arguments: (chunk as any).input })
                  seenStarts.add(callId)
                }
                break
              }
              case 'tool-result': {
                const callId = chunk.toolCallId || chunk.id || ''
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                const output = (chunk as any).output
                onToolEnd?.({ callId, name: original, result: output })
                break
              }
              case 'tool-error': {
                const callId = chunk.toolCallId || chunk.id || ''
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                const error = String((chunk as any)?.error?.message || (chunk as any)?.error || 'tool error')
                onToolError?.({ callId, name: original, error })
                break
              }
              case 'finish-step': {
                // Usage emitted in onStepFinish
                break
              }
              default:
                break
            }
          } catch (err: any) {
            onStreamError?.(String(err?.message || err))
          }
        },
        onStepFinish(step: any) {
          try {
            const calls = Array.isArray(step?.toolCalls) ? step.toolCalls.length : 0
            if (DEBUG) console.log('[ai-sdk:xai] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })

            // If this step had tool calls, drop any buffered text from this step
            if (hasTools) {
              if (calls > 0) {
                pendingText = ''
              } else if (pendingText) {
                onTextChunk?.(pendingText)
                pendingText = ''
              }
            }

            if (step?.usage && onTokenUsage) {
              const u: any = step.usage
              const usage = {
                inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0),
                outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0),
                totalTokens: Number(u.totalTokens ?? (Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0))),
                cachedTokens: Number(u.cachedInputTokens ?? u.cachedTokens ?? 0)
              }
              onTokenUsage(usage)
            }
          } catch {}
        },
        onFinish() {
          try {
            if (DEBUG) console.log('[ai-sdk:xai] onFinish')
            // Flush any remaining buffered text (final step without tools)
            if (pendingText) onTextChunk?.(pendingText)
            pendingText = ''
            onStreamDone?.()
          } catch {}
        },
        onError(ev: any) {
          const err = ev?.error ?? ev
          try {
            if (DEBUG) console.error('[ai-sdk:xai] onError', err)
            onStreamError?.(String(err?.message || err))
          } catch {}
        }
      } as any)
      // Ensure the stream is consumed so callbacks fire reliably
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:xai] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch {}
      })
    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:xai] adapter exception', err)
      try { onStreamError?.(String(err?.message || err)) } catch {}
    }

    return {
      cancel: () => {
        try { ac.abort() } catch {}
      }
    }
  }
}

