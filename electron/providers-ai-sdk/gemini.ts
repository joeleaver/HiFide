import { streamText, tool as aiTool, stepCountIs, jsonSchema } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { UiPayloadCache } from '../core/uiPayloadCache'
import { AGENT_MAX_STEPS } from '../../src/store/utils/constants'

import type { ProviderAdapter, StreamHandle, AgentTool, ChatMessage } from '../providers/provider'

// Gemini function tool name constraints: ^[A-Za-z][A-Za-z0-9_]{0,63}$
function sanitizeName(name: string): string {
  let safe = String(name || 'tool')
    .replace(/[^a-zA-Z0-9_]/g, '_') // disallow hyphens and other chars
  if (!safe) safe = 'tool'
  // Must start with a letter
  if (!/^[A-Za-z]/.test(safe)) safe = `t_${safe}`
  // Enforce max length 64 (leave room for suffixing later)
  if (safe.length > 64) safe = safe.slice(0, 64)
  return safe
}

function buildAiSdkTools(tools: AgentTool[] | undefined, meta?: { requestId?: string;[k: string]: any }) {
  const map: Record<string, any> = {}
  const nameMap = new Map<string, string>() // safe -> original

  for (const t of tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') continue
    const base = sanitizeName(t.name)
    // Ensure uniqueness if multiple names sanitize to same safe value
    let safe = base
    let i = 2
    while (Object.prototype.hasOwnProperty.call(map, safe) && nameMap.get(safe) !== t.name) {
      const trimmed = base.length > 60 ? base.slice(0, 60) : base
      safe = `${trimmed}_${i++}`
    }
    if (nameMap.has(safe) && nameMap.get(safe) !== t.name) {
      const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'
      if (DEBUG) console.warn('[ai-sdk:gemini] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
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
        } catch { }
        return raw
      }
    })
  }
  return { tools: map, nameMap }
}

function contentsToMessages(contents: Array<{ role: string; parts: Array<any> }>): ChatMessage[] {
  try {
    return (contents || []).map((c) => {
      const role = c?.role === 'model' ? 'assistant' : 'user'
      const parts = Array.isArray(c?.parts) ? c.parts : []
      
      if (parts.length === 0) return { role: role as any, content: '' }

      const contentParts = parts.map((p) => {
        if (typeof p?.text === 'string') {
          return { type: 'text' as const, text: p.text }
        }
        if (p?.inline_data) {
          // Gemini / AI-SDK Google Provider uses the 'file' type for images, PDFs, etc.
          // Ref: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#file-inputs
          try {
            const buffer = Buffer.from(p.inline_data.data, 'base64');
            return {
              type: 'file' as const,
              data: buffer,
              mediaType: p.inline_data.mime_type || 'image/png'
            };
          } catch (e) {
            console.error('[ai-sdk:gemini] failed to decode base64 file data', e);
            return null;
          }
        }
        return null
      }).filter((p): p is any => p !== null)

      // If it's just one text part, return string content for compatibility
      if (contentParts.length === 1 && contentParts[0].type === 'text') {
        return { role: role as any, content: contentParts[0].text }
      }

      return { role: role as any, content: contentParts }
    })
  } catch {
    return []
  }
}

export const GeminiAiSdkProvider: ProviderAdapter = {
  id: 'gemini',

  async agentStream({ apiKey, model, systemInstruction, contents, temperature, includeThoughts, thinkingBudget, tools, responseSchema: _responseSchema, emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const google = createGoogleGenerativeAI({ apiKey })
    const llm = google(model)

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    const systemText: string | undefined = typeof systemInstruction === 'string' ? systemInstruction : undefined
    const msgs = contentsToMessages((contents as any) || [])

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[ai-sdk:gemini] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      // Matches: gemini-2.5-*, gemini-3-*, gemini-3.0-*, etc.
      const supportsThinking = (id: string) => /(2\.5|[^0-9]3[.-])/i.test(String(id))
      const shouldThink = includeThoughts === true && supportsThinking(model)
      const providerOptions = shouldThink ? (() => {
        const raw = typeof thinkingBudget === 'number' ? thinkingBudget : 2048
        const thinkingConfig: any = { includeThoughts: true }
        if (raw !== -1) thinkingConfig.thinkingBudget = raw
        return { google: { thinkingConfig } }
      })() : undefined
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
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
              const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
              console.log('[ai-sdk:gemini] onChunk', { type: chunk.type, tool: (chunk as any).toolName, brief })
            }
            switch (chunk.type) {
              case 'text-delta': {
                const d = chunk.text || ''
                if (d) onTextChunk?.(d)
                break
              }
              case 'reasoning-delta': {
                const d = chunk.text || ''
                if (d) {
                  try { emit?.({ type: 'reasoning', provider: 'gemini', model, reasoning: d }) } catch { }
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
                  const args = (chunk as any).input
                  onToolStart?.({ callId, name: original, arguments: args })
                  seenStarts.add(callId)
                }
                break
              }
              case 'tool-result': {
                const callId = chunk.toolCallId || chunk.id || ''
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                let output: any = (chunk as any).output
                if (typeof output === 'undefined') {
                  output = (chunk as any).result ?? (chunk as any).toolResult ?? (chunk as any).data
                  if (typeof output === 'string') {
                    try {
                      const trimmed = output.trim()
                      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        output = JSON.parse(trimmed)
                      }
                    } catch { }
                  }
                }
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
            if (DEBUG) {
              const calls = Array.isArray(step?.toolCalls) ? step.toolCalls.length : 0
              console.log('[ai-sdk:gemini] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })
            }
            if (step?.usage && onTokenUsage) {
              const u: any = step.usage
              // Gemini 2.0 Flash Thinking: reasoning tokens are part of output tokens in some views,
              // but we want to separate them.
              // AI SDK often puts reasoning in `reasoningTokens` if available.
              const rt = Number(u.reasoningTokens ?? 0)
              const outTotal = Number(u.outputTokens ?? u.candidatesTokens ?? u.completionTokens ?? 0)

              // If total output includes reasoning, we might want to separate them for display?
              // Standard practice: outputTokens usually includes reasoning. 
              // But for UI clarity, let's try to keep them distinct if possible, or just report them.
              // Let's trust the provider's `outputTokens` as the "generated content + reasoning" usually,
              // unless we want to subtract. 
              // However, AI SDK v5 usually reports `outputTokens` and `reasoningTokens` separately in the object if they are distinct.
              // If `totalTokens` = input + output, and reasoning is a subset of output, we shouldn't double count.

              const inp = Number(u.inputTokens ?? u.promptTokens ?? 0)
              const cached = Number(u.cachedInputTokens ?? u.cachedTokens ?? u.cacheTokens ?? u.cachedContentTokenCount ?? 0)

              const usage = {
                inputTokens: inp,
                outputTokens: outTotal, // Keep as total output for now
                totalTokens: Number(u.totalTokens ?? (inp + outTotal)),
                cachedTokens: cached,
                reasoningTokens: rt
              }
              onTokenUsage(usage)
            }
          } catch { }
        },
        onFinish() {
          try {
            if (DEBUG) console.log('[ai-sdk:gemini] onFinish')
            onStreamDone?.()
          } catch { }
        },
        onError(ev: any) {
          const err = ev?.error ?? ev
          try {
            if (DEBUG) console.error('[ai-sdk:gemini] onError', err)
            onStreamError?.(String(err?.message || err))
          } catch { }
        }
      } as any)
      // Ensure the stream is consumed so callbacks fire reliably
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:gemini] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch { }
      })
    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:gemini] adapter exception', err)
      try { onStreamError?.(String(err?.message || err)) } catch { }
    }

    return {
      cancel: () => {
        try { ac.abort() } catch { }
      }
    }
  }
}
