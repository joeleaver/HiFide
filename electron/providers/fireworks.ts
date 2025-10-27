import OpenAI from 'openai'
import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'
import { formatSummary } from '../agent/types'
import { rateLimitTracker } from './rate-limit-tracker'

// Normalize various header shapes into a simple lower-cased map
const toHeaderMap = (h: any): Record<string, string> => {
  const map: Record<string, string> = {}
  try {
    if (!h) return map
    if (typeof h.forEach === 'function') {
      h.forEach((v: any, k: string) => { map[String(k).toLowerCase()] = String(v) })
    } else if (Array.isArray(h)) {
      for (const [k, v] of h as any) { map[String(k).toLowerCase()] = String(v) }
    } else if (typeof h === 'object') {
      for (const k of Object.keys(h)) { map[String(k).toLowerCase()] = String((h as any)[k]) }
    }
  } catch {}
  return map
}

// Helper to map our ChatMessage[] to Responses API input format
function toResponsesInput(messages: ChatMessage[]) {
  return (messages || []).map((m) => ({ role: m.role as any, content: m.content }))
}

export const FireworksProvider: ProviderAdapter = {
  id: 'fireworks',

  // Plain chat via Responses API with streaming chunks (match OpenAI provider)
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.fireworks.ai/inference/v1' })

    const holder: { stream?: any; cancelled?: boolean } = {}

    ;(async () => {
      let completed = false
      try {
        const stream: any = await withRetries(() => Promise.resolve(client.responses.stream({
          model,
          input: toResponsesInput(messages || []),
        })))
        holder.stream = stream
        try {
          for await (const evt of stream) {
            try {
              const type = (evt as any)?.type || ''
              let text: string | null = null
              if (typeof (evt as any)?.delta === 'string') {
                text = (evt as any).delta
              } else if (typeof (evt as any)?.text === 'string') {
                text = (evt as any).text
              } else if (type?.includes('output_text') && typeof (evt as any)?.text === 'string') {
                text = (evt as any).text
              }
              if (text) onChunk(text)
            } catch (e: any) {
              const error = e?.message || String(e)
              onError(error)
            }
          }
          // Extract token usage from final response
          try {
            const finalResponse = await stream.finalResponse()
            if (finalResponse?.usage) {
              const usage = {
                inputTokens: finalResponse.usage.input_tokens || 0,
                outputTokens: finalResponse.usage.output_tokens || 0,
                totalTokens: finalResponse.usage.total_tokens || 0,
              }
              if (onTokenUsage) onTokenUsage(usage)
            }
          } catch (e) {
            // Ignore token usage extraction failure
          }
          // Update rate limit tracker based on response headers, if available
          try {
            const hdrs = (stream as any)?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('fireworks' as any, model as any, toHeaderMap(hdrs))
            }
          } catch {}

          completed = true
          onDone()
        } catch (e: any) {
          if (e?.name === 'AbortError') return
          const error = e?.message || String(e)
          onError(error)
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        const error = e?.message || String(e)
        onError(error)
      } finally {
        if (!completed) {
          try { onDone() } catch {}
        }
      }
    })().catch((e: any) => {
      try { onError(e?.message || String(e)) } catch {}
    })

    return {
      cancel: () => {
        holder.cancelled = true
        try { holder.stream?.controller?.abort?.() } catch {}
        try { holder.stream?.close?.() } catch {}
      }
    }
  },

  // Agent loop with tool-calling using Chat Completions API (Fireworks supports tools here)
  async agentStream({ apiKey, model, messages, tools, emit: _emit, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError: _onToolError }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.fireworks.ai/inference/v1' })

    const holder: { abort?: () => void } = {}

    // Validate tools array
    if (!Array.isArray(tools)) {
      onError('Tools must be an array')
      return { cancel: () => {} }
    }

    // Sanitize tool names and build Chat Completions tools (nested function)
    const toolMap = new Map<string, AgentTool>()
    const usedNames = new Set<string>()
    const toSafeName = (name: string) => {
      let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
      if (!safe) safe = 'tool'
      let base = safe, i = 1
      while (usedNames.has(safe)) { i += 1; safe = `${base}_${i}` }
      usedNames.add(safe)
      return safe
    }

    const ccTools: any[] = tools
      .filter(t => t && t.name)
      .map((t) => {
        const safeName = toSafeName(t.name)
        toolMap.set(safeName, t)
        toolMap.set(t.name, t)
        return {
          type: 'function',
          function: {
            name: safeName,
            description: t.description || undefined,
            parameters: t.parameters || { type: 'object', properties: {} }
          }
        }
      })

    // Build Chat Completions message history from ChatMessage[]
    const toCCMsgs = (msgs: ChatMessage[]) => (msgs || []).map((m) => ({ role: m.role, content: m.content || '' }))
    const ccMsgs: any[] = toCCMsgs(messages || [])

    let cancelled = false
    let iteration = 0
    // Accumulate usage across the entire agent loop; emit once at the very end
    let cumInputTokens = 0
    let cumOutputTokens = 0
    let cumTotalTokens = 0


    const run = async () => {
      try {
        while (!cancelled && iteration < 200) {
          iteration++

          // Streaming chat.completions call with optional tools
          const ac = new AbortController()
          holder.abort = () => { try { ac.abort() } catch {} }

          let stream: any
          try {
            stream = await withRetries(() => Promise.resolve(
              client.chat.completions.create(
                {
                  model,
                  messages: ccMsgs as any,
                  tools: ccTools.length ? ccTools : undefined,
                  tool_choice: ccTools.length ? 'auto' : undefined,
                  temperature: 0.2,
                  stream: true,
                  // Ask for usage in the stream if provider supports it
                  stream_options: { include_usage: true } as any
                },
                { signal: ac.signal }
              )
            ))
          } catch (err: any) {
            // Fallback if Fireworks doesn't support stream_options/include_usage
            stream = await withRetries(() => Promise.resolve(
              client.chat.completions.create(
                {
                  model,
                  messages: ccMsgs as any,
                  tools: ccTools.length ? ccTools : undefined,
                  tool_choice: ccTools.length ? 'auto' : undefined,
                  temperature: 0.2,
                  stream: true
                },
                { signal: ac.signal }
              )
            ))
          }

          // Accumulate assistant text and tool call deltas for this turn
          let turnBuffer = ''
          const toolAcc = new Map<number, { id: string; name: string; args: string }>()
          let lastUsage: any = null

          for await (const chunk of stream) {
            try {
              // Capture usage if provider streams it
              const chunkUsage = (chunk as any)?.usage
              if (chunkUsage) lastUsage = chunkUsage

              const choice = (chunk as any)?.choices?.[0] || {}
              const delta = choice.delta || {}
              if (typeof delta.content === 'string') {
                turnBuffer += delta.content
              }
              const tcs = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
              for (const tc of tcs) {
                const idx = typeof tc.index === 'number' ? tc.index : 0
                if (!toolAcc.has(idx)) toolAcc.set(idx, { id: '', name: '', args: '' })
                const acc = toolAcc.get(idx)!
                if (tc.id) acc.id = tc.id
                const fn = tc.function || {}
                if (typeof fn.name === 'string') acc.name = (acc.name || '') + fn.name
                if (typeof fn.arguments === 'string') acc.args += fn.arguments
              }
            } catch (e: any) {
              onError(e?.message || String(e))
            }
          }

          // Update rate limit tracker from headers if available
          let headerMap: Record<string, string> | null = null
          try {
            const hdrs = (stream as any)?.response?.headers
            if (hdrs) {
              headerMap = toHeaderMap(hdrs)
              rateLimitTracker.updateFromHeaders('fireworks' as any, model as any, headerMap)
            }
          } catch {}

          // Accumulate token usage for this turn (from streamed usage or headers). Do not emit yet.
          try {
            let turnInputTokens = 0, turnOutputTokens = 0, turnTotalTokens = 0
            if (lastUsage) {
              // Prefer OpenAI-style names if present
              if (typeof lastUsage.prompt_tokens === 'number') turnInputTokens = lastUsage.prompt_tokens
              if (typeof lastUsage.completion_tokens === 'number') turnOutputTokens = lastUsage.completion_tokens
              if (typeof lastUsage.total_tokens === 'number') turnTotalTokens = lastUsage.total_tokens
              if (!turnTotalTokens) turnTotalTokens = turnInputTokens + turnOutputTokens
            } else if (headerMap) {
              const it = parseInt(headerMap['x-fireworks-usage-input-tokens'] || headerMap['x-fireworks-input-tokens'] || '')
              const ot = parseInt(headerMap['x-fireworks-usage-output-tokens'] || headerMap['x-fireworks-output-tokens'] || '')
              const tt = parseInt(headerMap['x-fireworks-usage-total-tokens'] || headerMap['x-fireworks-total-tokens'] || '')
              if (!isNaN(it)) turnInputTokens = it
              if (!isNaN(ot)) turnOutputTokens = ot
              if (!isNaN(tt)) turnTotalTokens = tt
              if (!turnTotalTokens) turnTotalTokens = (isNaN(it) ? 0 : it) + (isNaN(ot) ? 0 : ot)
            }
            cumInputTokens += turnInputTokens
            cumOutputTokens += turnOutputTokens
            cumTotalTokens += turnTotalTokens
          } catch {}

          // Finalize tool calls from accumulated deltas
          const toolCalls = Array.from(toolAcc.values())
            .filter(tc => (tc.id || tc.name || tc.args))
            .map(tc => {
              let argsObj: any = {}
              if (tc.args) { try { argsObj = JSON.parse(tc.args) } catch { try { argsObj = JSON.parse(tc.args.replace(/'/g, '"')) } catch {} } }
              // Use sanitized name if present
              const safe = toSafeName(tc.name || '')
              const nameToUse = toolMap.has(safe) ? safe : (toolMap.has(tc.name) ? tc.name : safe)
              return { id: tc.id || `call_${Math.random().toString(36).slice(2)}`, name: nameToUse, arguments: argsObj }
            })

          if (toolCalls.length > 0) {
            // Add assistant message with tool_calls to conversation
            const assistantMsg: any = {
              role: 'assistant',
              content: turnBuffer || '',
              tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } }))
            }
            ccMsgs.push(assistantMsg)

            // Execute tools sequentially, push tool outputs, then continue the loop
            let shouldPrune = false
            let pruneSummary: any = null
            const perTurnToolCache = new Map<string, any>()

            for (const tc of toolCalls) {
              const tool = toolMap.get(tc.name)
              if (!tool) {
                ccMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `Tool ${tc.name} not found` }) })
                continue
              }
              const args = tc.arguments || {}
              const v = validateJson(tool.parameters, args)
              if (!v.ok) {
                ccMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `Validation error: ${v.errors || 'invalid input'}` }) })
                continue
              }

              try { onToolStart?.({ callId: tc.id, name: tool.name, arguments: args }) } catch {}

              const dedupeKey = `${tool.name}:${JSON.stringify(args)}`
              let result: any
              if (perTurnToolCache.has(dedupeKey)) {
                result = perTurnToolCache.get(dedupeKey)
              } else {
                result = await Promise.race([
                  Promise.resolve(tool.run(args, toolMeta)),
                  new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool '${tool.name}' timed out after 15000ms`)), 15000))
                ])
                perTurnToolCache.set(dedupeKey, result)
              }

              try { onToolEnd?.({ callId: tc.id, name: tool.name, result }) } catch {}

              if (result?._meta?.trigger_pruning) { shouldPrune = true; pruneSummary = result._meta.summary }

              const { minifyToolResult } = await import('./toolResultMinify')
              const compact = minifyToolResult(tool.name, result)
              const output = typeof compact === 'string' ? compact : JSON.stringify(compact)
              ccMsgs.push({ role: 'tool', tool_call_id: tc.id, content: output })
            }

            // Optional: prune conversation
            if (shouldPrune && pruneSummary) {
              const sys = (messages || []).filter(m => m.role === 'system').map(m => ({ role: m.role, content: m.content }))
              const recent = ccMsgs.slice(-5)
              ccMsgs.length = 0
              ccMsgs.push(...sys, { role: 'user', content: formatSummary(pruneSummary) }, ...recent)
            }

            // Continue to the next assistant turn
            continue
          }

          // No tool calls -> emit buffered assistant text now and finish
          if (turnBuffer) onChunk(turnBuffer)
          try {
            if (onTokenUsage) {
              onTokenUsage({ inputTokens: cumInputTokens, outputTokens: cumOutputTokens, totalTokens: cumTotalTokens })
            }
          } catch {}
          onDone()
          return
        }
      } catch (e: any) {
        const msg = e?.message || ''
        if (e?.name === 'AbortError' || /cancel/i.test(msg)) { try { onDone() } catch {}; return }
        onError(msg || String(e))
      }
    }

    await run().catch((e: any) => { try { onError(e?.message || String(e)) } catch {} })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  },
}


