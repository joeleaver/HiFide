import { streamText, tool as aiTool, stepCountIs, jsonSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
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
      if (DEBUG) console.warn('[ai-sdk:openai] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
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

// Models that support reasoningEffort (o1, o3 families)
const supportsReasoningEffort = (id: string) => /^o[13](-|$)/i.test(id)

export const OpenAiSdkProvider: ProviderAdapter = {
  id: 'openai',

  async agentStream({ apiKey, model, system, messages, temperature, reasoningEffort, tools, responseSchema: _responseSchema, emit: _emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError, onStep }): Promise<StreamHandle> {
    const oai = createOpenAI({ apiKey })
    const llm = oai(model)

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    // Expect system to be provided top-level (string) and messages without system-role
    const systemText: string | undefined = typeof system === 'string' ? system : undefined
    const msgs = (messages || []) as any

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[ai-sdk:openai] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length, reasoningEffort })
      }
      // OpenAI provider options for o1/o3 reasoning models
      const providerOptions = supportsReasoningEffort(model) && reasoningEffort
        ? { openai: { reasoningEffort } }
        : undefined
      const result = streamText({
        model: llm,
        system: systemText,
        messages: msgs as any,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        parallelToolCalls: false,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        abortSignal: ac.signal,
        stopWhen: stepCountIs(AGENT_MAX_STEPS),
        includeRawChunks: DEBUG,
        providerOptions: providerOptions as any,
        // Stream mapping (AI SDK v5 onChunk passes { chunk })
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
              const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
              console.log('[ai-sdk:openai] onChunk', { type: chunk.type, tool: (chunk as any).toolName, brief })
            }
            switch (chunk.type) {
              case 'text-delta': {
                const d = chunk.text || ''
                if (d) onTextChunk?.(d)
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
                // Usage is emitted in onStepFinish; avoid double-counting here
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
            if (DEBUG) console.log('[ai-sdk:openai] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })

            if (onStep) {
              onStep({
                text: step.text,
                reasoning: step.reasoning,
                toolCalls: step.toolCalls,
                toolResults: step.toolResults
              })
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
            if (DEBUG) console.log('[ai-sdk:openai] onFinish')
            onStreamDone?.()
          } catch {}
        },
        onError(ev: any) {
          const err = ev?.error ?? ev
          try {
            if (DEBUG) console.error('[ai-sdk:openai] onError', err)
            onStreamError?.(String(err?.message || err))
          } catch {}
        }
      } as any)
      // Ensure the stream is consumed so callbacks fire reliably
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:openai] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch {}
      })
    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:openai] adapter exception', err)
      try { onStreamError?.(String(err?.message || err)) } catch {}
    }

    return {
      cancel: () => {
        try { ac.abort() } catch {}
      }
    }
  }
}

