import { streamText, tool as aiTool, stepCountIs, jsonSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from '../providers/provider'

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
    nameMap.set(safe, t.name)
    // Prefer the tool's declared JSON Schema; fallback to permissive schema
    const inputSchema = t.parameters && typeof t.parameters === 'object' ? jsonSchema(t.parameters) : z.any()
    map[safe] = aiTool<any, any>({
      description: t.description || undefined,
      inputSchema,
      execute: async (input: any) => {
        return await t.run(input, meta)
      }
    })
  }
  return { tools: map, nameMap }
}

export const OpenAiSdkProvider: ProviderAdapter = {
  id: 'openai',

  async agentStream({ apiKey, model, instructions, systemInstruction, system, messages, temperature, tools, responseSchema: _responseSchema, emit: _emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const oai = createOpenAI({ apiKey })
    const llm = oai(model)

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    // Normalize messages and system instructions for AI SDK
    // - Accept systemInstruction (preferred) or system (string or Anthropic-style parts)
    // - Collapse any system-role messages into a single system string
    // - Avoid duplication by removing system-role entries from messages when passing `system`
    const sysParts: string[] = []

    // Top-level instructions take precedence
    if (typeof instructions === 'string' && instructions.trim()) {
      sysParts.push(instructions)
    }

    // Then systemInstruction
    if (!sysParts.length && typeof systemInstruction === 'string' && systemInstruction.trim()) {
      sysParts.push(systemInstruction)
    }

    // Support optional `system` param (string or array of text parts)
    if (!sysParts.length && typeof system === 'string' && system.trim()) {
      sysParts.push(system)
    } else if (!sysParts.length && Array.isArray(system)) {
      const texts = system
        .map((p: any) => (typeof p?.text === 'string' ? p.text : undefined))
        .filter(Boolean) as string[]
      if (texts.length) sysParts.push(texts.join('\n\n'))
    }

    // Separate out system-role messages and user/assistant messages
    const systemMsgs: string[] = []
    const nonSystemMsgs = (messages || []).map((m: ChatMessage) => {
      if (m.role === 'system') {
        systemMsgs.push(typeof m.content === 'string' ? m.content : String(m.content))
        return null as any
      }
      return { role: m.role as any, content: m.content }
    }).filter(Boolean)

    // If no explicit systemInstruction/system provided, fall back to system messages
    if (!sysParts.length && systemMsgs.length) {
      sysParts.push(systemMsgs.join('\n\n'))
    }

    const systemText: string | undefined = sysParts.length ? sysParts.join('\n\n') : undefined
    // If we have a systemText, use non-system messages to avoid duplication; else keep original mapping
    const msgs = systemText ? (nonSystemMsgs as any) : (messages || []).map((m: ChatMessage) => ({ role: m.role as any, content: m.content }))

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[ai-sdk:openai] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      const result = streamText({
        model: llm,
        ...(typeof systemText === 'string' ? { instructions: systemText } : {}),
        messages: msgs as any,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        temperature: typeof temperature === 'number' ? temperature : undefined,
        abortSignal: ac.signal,
        stopWhen: stepCountIs(50),
        includeRawChunks: DEBUG,
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
                if (!seenStarts.has(callId)) {
                  seenStarts.add(callId)
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original })
                }
                break
              }
              case 'tool-input-delta': {
                // We could surface arg deltas later; for now just ensure start is emitted
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId && !seenStarts.has(callId)) {
                  seenStarts.add(callId)
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original })
                }
                break
              }
              case 'tool-call': {
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId && !seenStarts.has(callId)) {
                  seenStarts.add(callId)
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original, arguments: (chunk as any).input })
                }
                break
              }
              case 'tool-result': {
                const callId = chunk.toolCallId || chunk.id || ''
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                onToolEnd?.({ callId, name: original, result: (chunk as any).output })
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
              console.log('[ai-sdk:openai] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })
            }
            if (step?.usage && onTokenUsage) {
              const u: any = step.usage
              const usage = {
                inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0),
                outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0),
                totalTokens: Number(u.totalTokens ?? (Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0)))
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

