import { streamText, tool as aiTool, stepCountIs, jsonSchema } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool } from '../providers/provider'

function sanitizeName(name: string): string {
  let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!safe) safe = 'tool'
  return safe
}

function blocksToSystemText(system: any): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') return system
  try {
    if (Array.isArray(system)) {
      const texts = system
        .map((b: any) => (typeof b?.text === 'string' ? b.text : undefined))
        .filter(Boolean) as string[]
      if (texts.length) return texts.join('\n\n')
    }
  } catch {}
  return undefined
}

function buildAiSdkTools(tools: AgentTool[] | undefined, meta?: { requestId?: string; [k: string]: any }) {
  const map: Record<string, any> = {}
  const nameMap = new Map<string, string>() // safe -> original
  for (const t of tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') continue
    const safe = sanitizeName(t.name)
    if (nameMap.has(safe) && nameMap.get(safe) !== t.name) {
      const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'
      if (DEBUG) console.warn('[ai-sdk:anthropic] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
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

export const AnthropicAiSdkProvider: ProviderAdapter = {
  id: 'anthropic',

  async agentStream({ apiKey, model, system, messages, temperature, tools, responseSchema: _responseSchema, emit: _emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const anthropic = createAnthropic({ apiKey })
    const llm = anthropic(model)

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    // Anthropic expects a string for system in AI SDK; convert from blocks if needed
    const systemText: string | undefined = blocksToSystemText(system)
    const msgs = (messages || []) as any

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[ai-sdk:anthropic] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      const result = streamText({
        model: llm,
        system: systemText,
        messages: msgs as any,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        temperature: typeof temperature === 'number' ? temperature : undefined,
        abortSignal: ac.signal,
        stopWhen: stepCountIs(AGENT_MAX_STEPS),
        includeRawChunks: DEBUG,
        // Stream mapping (AI SDK v5 onChunk passes { chunk })
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
              const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
              console.log('[ai-sdk:anthropic] onChunk', { type: chunk.type, tool: (chunk as any).toolName, brief })
            }
            switch (chunk.type) {
              case 'text-delta': {
                const d = chunk.text || ''
                if (d) onTextChunk?.(d)
                break
              }
              case 'tool-input-start': {
                // Only emit when input arguments are present; otherwise wait for 'tool-call' to provide full args.
                const callId = chunk.toolCallId
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
                // Do not emit start based on deltas; wait for 'tool-call' which includes full arguments.
                break
              }
              case 'tool-call': {
                const callId = chunk.toolCallId
                if (callId) {
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  const args = (chunk as any).input
                  onToolStart?.({ callId, name: original, arguments: args })
                  seenStarts.add(callId)
                }
                break
              }
              case 'tool-result': {
                const callId = chunk.toolCallId
                if (!callId) break
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                let output: any = (chunk as any).output
                if (typeof output === 'undefined') {
                  output = (chunk as any).result ?? (chunk as any).toolResult ?? (chunk as any).data
                  // Attempt to parse if stringified JSON
                  if (typeof output === 'string') {
                    try {
                      const trimmed = output.trim()
                      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        output = JSON.parse(trimmed)
                      }
                    } catch {}
                  }
                }
                // Unwrap AI SDK structured result shapes
                if (output && typeof output === 'object') {
                  const o: any = output
                  if (o.type === 'json' && 'value' in o) {
                    output = o.value
                  } else if ('json' in o && o.json && typeof o.json === 'object') {
                    output = o.json
                  }
                }
                onToolEnd?.({ callId, name: original, result: output })
                break
              }
              case 'tool-error': {
                const callId = chunk.toolCallId
                if (!callId) break
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
            if (DEBUG) {
              const calls = Array.isArray(step?.toolCalls) ? step.toolCalls.length : 0
              console.log('[ai-sdk:anthropic] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })
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
            if (DEBUG) console.log('[ai-sdk:anthropic] onFinish')
            onStreamDone?.()
          } catch {}
        },
        onError(ev: any) {
          const err = ev?.error ?? ev
          try {
            if (DEBUG) console.error('[ai-sdk:anthropic] onError', err)
            onStreamError?.(String(err?.message || err))
          } catch {}
        }
      })
      // Ensure the stream is consumed so callbacks fire reliably
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:anthropic] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch {}
      })
    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:anthropic] adapter exception', err)
      try { onStreamError?.(String(err?.message || err)) } catch {}
    }

    return {
      cancel: () => {
        try { ac.abort() } catch {}
      }
    }
  }
}

