import { streamText, tool as aiTool, stepCountIs, jsonSchema, wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import { createFireworks } from '@ai-sdk/fireworks'
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
      const DEBUG = true; // = process.env.HF_AI_SDK_DEBUG === '1' || process.env.HF_DEBUG_AI_SDK === '1'
      if (DEBUG) console.warn('[ai-sdk:fireworks] tool name collision after sanitize', { safe, a: nameMap.get(safe), b: t.name })
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

export const FireworksAiSdkProvider: ProviderAdapter = {
  id: 'fireworks',

  async agentStream({ apiKey, model, system, messages, temperature, tools, responseSchema: _responseSchema, emit, onChunk: onTextChunk, onDone: onStreamDone, onError: onStreamError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError, onStep }): Promise<StreamHandle> {
    const fw = createFireworks({ apiKey })
    const llm = fw(model)
    // Wrap model to extract <think> reasoning into separate reasoning chunks
    const enhancedModel = wrapLanguageModel({
      model: llm as any,
      middleware: extractReasoningMiddleware({ tagName: 'think' })
    })

    const { tools: aiTools, nameMap } = buildAiSdkTools(tools, toolMeta)

    const seenStarts = new Set<string>()

    const ac = new AbortController()

    // Expect system to be provided top-level (string) and messages without system-role
    const systemText: string | undefined = typeof system === 'string' ? system : undefined
    const msgs = (messages || []) as any

    // Buffer for text chunks to filter out "None" artifacts from reasoning models
    let textBuffer = ''
    let hasEmittedText = false
    
    // Buffer for reasoning chunks to filter out "None" artifacts at start
    let reasoningBuffer = ''
    let hasEmittedReasoning = false

    const flushText = () => {
      if (textBuffer) {
        // Filter out standalone "None" artifacts which are common with this provider/model combo
        // particularly after tool calls or before reasoning blocks.
        // We use trim() to handle "None\n" or "\nNone".
        const trimmed = textBuffer.trim()
        if (trimmed === 'None' && !hasEmittedText) {
          // It's the artifact. Drop it.
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
        console.log('[ai-sdk:fireworks] streamText start', { model, msgs: msgs.length, tools: Object.keys(aiTools).length })
      }
      const result = streamText({
        model: enhancedModel,
        system: systemText,
        messages: msgs as any,
        tools: Object.keys(aiTools).length ? aiTools : undefined,
        toolChoice: Object.keys(aiTools).length ? 'auto' : 'none',
        parallelToolCalls: true,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        abortSignal: ac.signal,
        stopWhen: stepCountIs(AGENT_MAX_STEPS),
        includeRawChunks: DEBUG,
        onChunk({ chunk }: any) {
          try {
            if (DEBUG) {
              const brief = typeof (chunk as any).text === 'string' ? (chunk as any).text.slice(0, 40) : undefined
              console.log('[ai-sdk:fireworks] onChunk', { type: chunk.type, tool: (chunk as any).toolName, brief })
            }
            switch (chunk.type) {
              case 'text-delta': {
                // Reset reasoning state as we are back to text
                hasEmittedReasoning = false
                reasoningBuffer = ''

                const d = chunk.text || ''
                if (d) {
                  textBuffer += d
                  const t = textBuffer.trim()
                  if (['N', 'No', 'Non', 'None'].includes(t)) {
                    // Wait for more context
                  } else {
                    flushText()
                  }
                }
                break
              }
              case 'reasoning-delta': {
                flushText() 
                // Don't reset hasEmittedText here; reasoning interrupts text stream but doesn't necessarily invalidate previous text emission state

                const d = chunk.text || ''
                if (d) {
                  if (!hasEmittedReasoning) {
                    reasoningBuffer += d
                    const trimmed = reasoningBuffer.trimStart()
                    
                    // Check if buffer matches a prefix of "None"
                    if (['N', 'No', 'Non', 'None'].includes(trimmed)) {
                       // wait for more context
                    } else if (trimmed.startsWith('None')) {
                         // It's longer than "None". Check if we should strip it.
                         // Heuristic: Strip "None" if followed by something that isn't a lowercase letter, space, comma, or period.
                         // This targets "None**", "NoneNow", "None\n" while preserving "Nonetheless", "None of".
                         // Also strip if it is just "None" followed by non-alpha (e.g. "None-").
                         
                         // We look at the character immediately following 'None'
                         // trimmed is "NoneX..."
                         const after = trimmed.slice(4)
                         const firstChar = after.charAt(0)
                         
                         // Allowed followers (preserve None): [a-z], space, comma, period
                         // Disallowed followers (strip None): [A-Z], *, \n, digits, symbols
                         
                         if (/[a-z ,.]/.test(firstChar)) {
                            // Valid usage (e.g. "None of", "None.", "Nonetheless")
                            emit?.({ type: 'reasoning', provider: 'fireworks', model, reasoning: reasoningBuffer })
                            hasEmittedReasoning = true
                            reasoningBuffer = ''
                         } else {
                            // Artifact usage (e.g. "None**", "NoneNow", "None\n")
                            // Strip "None" (and the leading whitespace from original buffer if any, effectively used trimmed logic)
                            
                            emit?.({ type: 'reasoning', provider: 'fireworks', model, reasoning: after })
                            hasEmittedReasoning = true
                            reasoningBuffer = ''
                         }
                    } else {
                      // Does not start with None (e.g. "Okay..."), emit immediately
                      emit?.({ type: 'reasoning', provider: 'fireworks', model, reasoning: reasoningBuffer })
                      hasEmittedReasoning = true
                      reasoningBuffer = ''
                    }
                  } else {
                    // Already emitting, pass through
                    emit?.({ type: 'reasoning', provider: 'fireworks', model, reasoning: d })
                  }
                }
                break
              }
              case 'tool-input-start': {
                flushText()
                hasEmittedText = false
                hasEmittedReasoning = false
                reasoningBuffer = ''
                
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId && !seenStarts.has(callId)) {
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
                break
              }
              case 'tool-call': {
                flushText()
                hasEmittedText = false
                hasEmittedReasoning = false
                reasoningBuffer = ''
                
                const callId = chunk.toolCallId || chunk.id || ''
                if (callId && !seenStarts.has(callId)) {
                  const safe = String(chunk.toolName || '')
                  const original = nameMap.get(safe) || safe
                  onToolStart?.({ callId, name: original, arguments: (chunk as any).input })
                  seenStarts.add(callId)
                }
                break
              }
              case 'tool-result': {
                flushText()
                hasEmittedText = false
                hasEmittedReasoning = false
                reasoningBuffer = ''
                
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
            if (DEBUG) console.log('[ai-sdk:fireworks] onStepFinish', { calls, finishReason: step?.finishReason, usage: step?.usage })

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
            if (DEBUG) console.log('[ai-sdk:fireworks] onFinish')
            flushText()
            // Flush any pending reasoning buffer if valid
            if (reasoningBuffer && !hasEmittedReasoning) {
               // If it's just "None" at the very end, we probably drop it too?
               const trimmed = reasoningBuffer.trim()
               if (trimmed !== 'None') {
                 emit?.({ type: 'reasoning', provider: 'fireworks', model, reasoning: reasoningBuffer })
               }
            }
            onStreamDone?.()
          } catch {}
        },
        onError(ev: any) {
          const err = ev?.error ?? ev
          try {
            if (DEBUG) console.error('[ai-sdk:fireworks] onError', err)
            onStreamError?.(String(err?.message || err))
          } catch {}
        }
      } as any)
      result.consumeStream().catch((err: any) => {
        if (DEBUG) console.error('[ai-sdk:fireworks] consumeStream error', err)
        try { onStreamError?.(String(err?.message || err)) } catch {}
      })
    } catch (err: any) {
      if (DEBUG) console.error('[ai-sdk:fireworks] adapter exception', err)
      try { onStreamError?.(String(err?.message || err)) } catch {}
    }

    return {
      cancel: () => {
        try { ac.abort() } catch {}
      }
    }
  }
}
