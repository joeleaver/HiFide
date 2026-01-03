import { streamText, tool as aiTool, stepCountIs, jsonSchema, wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
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
      if (DEBUG) console.warn('[ai-sdk:openrouter] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
    }
    nameMap.set(safe, t.name)
    // Prefer the tool's declared JSON Schema; fallback to permissive schema
    const inputSchema = t.parameters && typeof t.parameters === 'object' ? jsonSchema(t.parameters) : z.any()
    map[safe] = aiTool({
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

export const OpenRouterAiSdkProvider: ProviderAdapter = {
  id: 'openrouter',

  async agentStream({ apiKey, model, system, messages, temperature, tools, responseSchema: _responseSchema, emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError, onStep }): Promise<StreamHandle> {
    const or = createOpenRouter({ apiKey })
    const llm = or(model)
    
    // Wrap model to extract <think> reasoning into separate reasoning chunks
    // This is crucial for models like DeepSeek R1 via OpenRouter
    const enhancedModel = wrapLanguageModel({
      model: llm as any,
      middleware: extractReasoningMiddleware({ tagName: 'think' })
    })

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)
    const seenStarts = new Set<string>()
    const ac = new AbortController()

    // Expect system to be provided top-level (string) and messages without system-role
    const systemText: string | undefined = typeof system === 'string' ? system : undefined
    const msgs = (messages || []) as any[]

    // Buffer for text chunks to filter out "None" artifacts
    let textBuffer = ''
    let hasEmittedText = false

    const processTextChunk = (text: string) => {
      // Accumulate buffer
      textBuffer += text
      
      // Heuristic: If we haven't emitted yet, and buffer is exactly "None" or "None\n" or similar, wait.
      // If buffer gets longer than "None" and doesn't match, flush.
      // If buffer IS "None" and we finish, we drop it (handled in onFinish/flush).
      
      const trimmed = textBuffer.trim()
      
      // If strictly "None", wait (don't emit yet)
      if (!hasEmittedText && (trimmed === 'None' || 'None'.startsWith(trimmed))) {
         return
      }

      // If we have "None" prefix but now more text, check if it was just "None" artifact or real text starting with None
      // But typically the artifact is standalone.
      // For now, simple flush if it's not the exact match or we already emitted.
      
      if (textBuffer.length > 0) {
        // Double check the "None" start if strictly waiting
        if (!hasEmittedText && textBuffer.trim() === 'None') {
          return // Still wait
        }
        
        onTextChunk?.(textBuffer)
        hasEmittedText = true
        textBuffer = ''
      }
    }

    const flushText = () => {
      if (textBuffer) {
        const trimmed = textBuffer.trim()
        if (!hasEmittedText && trimmed === 'None') {
          // Drop it
          textBuffer = ''
          return
        }
        onTextChunk?.(textBuffer)
        hasEmittedText = true
        textBuffer = ''
      }
    }

    const DEBUG = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'

    try {
      if (DEBUG) {
        console.log('[ai-sdk:openrouter] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      
      const result = streamText({
        model: enhancedModel,
        system: systemText,
        messages: msgs,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        // AI SDK typing differs across providers; omit parallelToolCalls for broad compatibility.
        temperature: typeof temperature === 'number' ? temperature : undefined,
        abortSignal: ac.signal,
        stopWhen: stepCountIs(AGENT_MAX_STEPS),
        
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
               const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
               console.log('[ai-sdk:openrouter] onChunk', { type: chunk.type, brief })
            }
            
            switch (chunk.type) {
              case 'text-delta': {
                const d = chunk.text || ''
                if (d) processTextChunk(d)
                break
              }
              case 'reasoning': { 
                // If middleware emits reasoning chunks
                const r = chunk.textDelta || chunk.text || ''
                if (r) {
                  emit?.({ type: 'reasoning', provider: 'openrouter', model, reasoning: r })
                }
                break
              }
              case 'tool-call': {
                // Ensure pending text is flushed before tool call
                flushText()
                
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId) {
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original, arguments: (chunk as any).args })
                  seenStarts.add(callId)
                }
                break
              }
              case 'tool-result': {
                const callId = chunk.toolCallId || chunk.id || ''
                const safe = String(chunk.toolName || '')
                const original = nameMap.get(safe) || safe
                const output = (chunk as any).result
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
            }
          } catch (err: any) {
            onStreamError?.(String(err?.message || err))
          }
        },
        onStepFinish(step: any) {
          try {
            flushText() // Ensure text is flushed at end of step
            
            if (DEBUG) console.log('[ai-sdk:openrouter] onStepFinish', { finishReason: step?.finishReason, usage: step?.usage })

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
            if (DEBUG) console.log('[ai-sdk:openrouter] onFinish')
            flushText()
            onStreamDone?.()
          } catch {}
        },
        onError(ev: any) {
           const err = ev?.error ?? ev
           if (DEBUG) console.error('[ai-sdk:openrouter] onError', err)
           onStreamError?.(String(err?.message || err))
        }
      } as any)

      // CRITICAL: Consume the stream to ensure callbacks fire
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:openrouter] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch {}
      })

    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:openrouter] adapter exception', err)
      onStreamError?.(String(err?.message || err))
    }

    return {
      cancel: () => {
        try { ac.abort() } catch {}
      }
    }
  }
}
