import OpenAI from 'openai'
import { logProviderHttp } from './provider'

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

// Helper to split system instructions (Responses API uses top-level 'instructions')
function splitInstructions(messages: ChatMessage[]) {
  const sys = (messages || []).filter(m => m.role === 'system').map(m => m.content).filter(Boolean)
  const instructions = sys.length ? sys.join('\n\n') : undefined
  const input = (messages || []).filter(m => m.role !== 'system').map((m) => ({ role: m.role as any, content: m.content }))
  return { instructions, input }
}

// Note: We no longer maintain session state for conversation chaining.
// The scheduler manages all conversation history and passes full message arrays.
// This makes providers stateless and simplifies context management.


export const OpenAIProvider: ProviderAdapter = {
  id: 'openai',

  // Agent loop with tool-calling via Responses API
  async agentStream({ apiKey, model, messages, temperature, reasoningEffort, tools, responseSchema, emit: _emit, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    const holder: { abort?: () => void } = {}

    // Validate tools array
    if (!Array.isArray(tools)) {
      const error = 'Tools must be an array'
      onError(error)
      return { cancel: () => {} }
    }

    // Map internal tools to OpenAI Responses tool format (sanitize names)
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

    const oaTools: any[] = tools
      .filter(t => t && t.name) // Filter out invalid tools
      .map((t) => {
        const safeName = toSafeName(t.name)
        toolMap.set(safeName, t)
        // Responses API uses flat structure: { type: "function", name, description, parameters }
        // NOT nested like Chat Completions: { type: "function", function: { name, ... } }
        return {
          type: 'function',
          name: safeName,
          description: t.description || undefined,
          parameters: t.parameters || { type: 'object', properties: {} },
        }
      })

    // Debug logging

    // Responses API uses a different format than Chat Completions
    // Input can be: { role, content } OR { type, call_id, output } for function results
    const { instructions, input: initialInput } = splitInstructions(messages || [])
    let conv: Array<any> = (initialInput || [])
      .map((m) => ({ role: m.role, content: m.content || '' }))
      .filter(m => m.content !== '') // Remove messages with empty content

    let cancelled = false
    let iteration = 0
    let cumulativeTokens = 0

    // Helper to check cancellation and throw if cancelled
    const checkCancelled = () => {
      if (cancelled) {
        throw new Error('Agent stream cancelled')
      }
    }

    // Helper to prune conversation when agent requests it
    const pruneConversation = (summary: any) => {
      const recent = conv.slice(-5) // Keep last 5 messages

      const summaryMsg = {
        role: 'user' as const,
        content: formatSummary(summary),
      }

      // Rebuild conversation: summary + recent (system stays in top-level instructions)
      conv = [summaryMsg, ...recent]
    }

    const run = async () => {
      try {
        while (!cancelled && iteration < 200) { // Hard limit of 200 iterations as safety (allows complex multi-file operations)
          // Check for cancellation at the start of each iteration
          checkCancelled()

          iteration++
          // Start a streaming turn; stream user-visible text as it comes, while accumulating any tool calls
          let useResponseFormat = !!responseSchema
          const mkOpts = (strict: boolean) => {
            const isReasoningCapable = /(o3|gpt-5)/i.test(String(model || ''))
            const isO3OrCodex = /(o3|codex)/i.test(String(model || ''))
            const opts: any = {
              model,
              input: conv as any,
            }
            if (instructions) {
              opts.instructions = instructions
            }
            if (isReasoningCapable && reasoningEffort) {
              opts.reasoning = { effort: reasoningEffort }
            }
            if (typeof temperature === 'number' && !isO3OrCodex) {
              opts.temperature = temperature
            }
            // Only add tools if we have valid tools
            if (oaTools.length > 0) {
              opts.tools = oaTools
              opts.tool_choice = 'auto'
            }
            // Add response format if requested (Responses API uses text.format, not response_format)
            if (strict && responseSchema) {
              opts.text = {
                format: {
                  type: 'json_schema',
                  name: responseSchema.name,
                  strict: responseSchema.strict,
                  schema: responseSchema.schema
                }
              }
            }
            return opts
          }

          let stream: any
          try {
            const opts = mkOpts(useResponseFormat)
            // Stateless: no session chaining
            try {
              // Exact request (env-gated)
              logProviderHttp({ provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, body: opts })
              stream = await withRetries(() => Promise.resolve(client.responses.stream(opts)))
            } catch (err: any) {
              const msg = String(err?.message || err)
              if (/Unsupported parameter/i.test(msg) && /temperature/i.test(msg)) {
                try { delete (opts as any).temperature } catch {}
                stream = await withRetries(() => Promise.resolve(client.responses.stream(opts)))
              } else {
                throw err
              }
            }
            holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }
          } catch (err: any) {
            const msg = err?.message || ''
            if (useResponseFormat && (err?.status === 400 || /response_format|text\.format|json_schema|unsupported/i.test(msg))) {
              useResponseFormat = false
              // Exact request (env-gated)
              logProviderHttp({ provider: 'openai', method: 'POST', url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, body: mkOpts(false) })
              stream = await withRetries(() => Promise.resolve(client.responses.stream(mkOpts(false))))
            } else {
              throw err
            }
          }

          // Track streaming tool calls (single-request handshake if SDK supports it)
          const pendingArgs: Map<string, { name: string; buf: string }> = new Map()
          let streamedToolActivity = false
          const canSubmitToolOutputs = typeof (stream as any)?.submitToolOutputs === 'function'

          // Fallback path: if submitToolOutputs fails (e.g., 400 No tool call found),
          // push function_call + function_call_output into conv and abort the stream to retry via legacy path.
          let abortEarly = false
          const fallbackSubmit = (callId?: string, name?: string, argsObj?: any, output?: string) => {
            try {
              if (callId && name) {
                conv.push({ type: 'function_call', call_id: callId, name, arguments: argsObj || {} })
                conv.push({ type: 'function_call_output', call_id: callId, output: output ?? JSON.stringify({ error: 'Unknown tool error' }) })
                streamedToolActivity = false // ensure legacy path will process on next turn
              }
            } catch {}
            try { (stream as any)?.controller?.abort?.() } catch {}
            abortEarly = true
          }

          // Track which output items are active (messages vs tool calls) by output_index/id
          const activeItems = new Map<string, { type: string; role?: string }>()

          for await (const evt of stream) {
            try {
              const t = String(evt?.type || '')

              // Output items lifecycle — do not print here; just track
              if (t === 'response.output_item.added') {
                const item = (evt as any)?.item
                const id = String((item?.id || (evt as any)?.id || ''))
                if (id) activeItems.set(id, { type: String(item?.type || ''), role: (item as any)?.role })
                continue
              }
              if (t === 'response.output_item.done') {
                const item = (evt as any)?.item
                const id = String((item?.id || (evt as any)?.id || ''))
                if (id) activeItems.delete(id)
                continue
              }

              // Function tool call argument streaming
              if (canSubmitToolOutputs && t === 'response.function_call.arguments.delta') {
                const callId = (evt as any)?.call_id || (evt as any)?.id || (evt as any)?.item?.id
                const name = (evt as any)?.name || (evt as any)?.function?.name || (evt as any)?.item?.name
                const delta = typeof (evt as any)?.delta === 'string' ? (evt as any).delta : (typeof (evt as any)?.arguments === 'string' ? (evt as any).arguments : '')
                if (callId) {
                  if (!pendingArgs.has(callId)) {
                    pendingArgs.set(callId, { name: String(name || ''), buf: '' })
                    try { onToolStart?.({ callId, name: toolMap.get(String(name || ''))?.name || String(name || '') }) } catch {}
                  }
                  const rec = pendingArgs.get(callId)!
                  rec.buf += (delta || '')
                  streamedToolActivity = true
                  continue
                }
              }

              if (canSubmitToolOutputs && t === 'response.function_call.completed') {
                const callId = (evt as any)?.call_id || (evt as any)?.id || (evt as any)?.item?.id
                const nameSafe = String((evt as any)?.name || (evt as any)?.function?.name || (evt as any)?.item?.name || '')
                const rec = callId ? pendingArgs.get(callId) : undefined
                const name = rec?.name || nameSafe
                let argsObj: any = {}
                try {
                  const raw = rec?.buf ?? ((evt as any)?.arguments ?? '')
                  if (typeof raw === 'string' && raw.trim()) {
                    argsObj = JSON.parse(raw)
                  }
                } catch {}

                const tool = toolMap.get(name)
                if (!tool) {
                  streamedToolActivity = true
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: `Tool ${name} not found` }) }]) } catch (e) { fallbackSubmit(callId, name, argsObj, JSON.stringify({ error: `Tool ${name} not found` })) }
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                const schema = (tool as any)?.parameters
                const v = validateJson(schema, argsObj)
                if (!v.ok) {
                  streamedToolActivity = true
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: `Validation error: ${v.errors || 'invalid input'}` }) }]) } catch (e) { fallbackSubmit(callId, name, argsObj, JSON.stringify({ error: `Validation error: ${v.errors || 'invalid input'}` })) }
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                let result: any
                try {
                  result = await Promise.resolve(tool.run(argsObj, toolMeta))
                  try { onToolEnd?.({ callId, name: tool?.name || name, result }) } catch {}
                } catch (err: any) {
                  const errMsg = err?.message || String(err)
                  try { onToolError?.({ callId, name: tool?.name || name, error: errMsg }) } catch {}
                  streamedToolActivity = true
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: errMsg }) }]) } catch (e) { fallbackSubmit(callId, name, argsObj, JSON.stringify({ error: errMsg })) }
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                // Format output (no minification/compression; return raw result)
                const output: string = typeof result === 'string' ? result : JSON.stringify(result)

                streamedToolActivity = true
                try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output }]) } catch (e) { fallbackSubmit(callId, name, argsObj, output) }
                if (callId) pendingArgs.delete(callId)
                continue
              }

              // Strictly print only output text stream events
              if (t === 'response.output_text.delta') {
                const delta = (evt as any)?.delta
                if (typeof delta === 'string' && delta) {
                  try { onChunk(delta) } catch (e) { try { onError(String(e)) } catch {} }
                }
                continue
              }
              if (t === 'response.output_text.done') {
                // no-op; end of text streaming for current item
                continue
              }
            } catch (e: any) {
              const error = e?.message || String(e)
              onError(error)
            }
          }

          // After stream completes, get the final response with complete output array
          let finalResponse: any
          try {
            finalResponse = await stream.finalResponse()
          } catch (e) {
            if (abortEarly) {
              finalResponse = { output: [] }
            } else {
              throw e
            }
          }
          // Update rate limit tracker from headers on streamed agent turn
          try {
            const hdrs = (stream as any)?.response?.headers || (finalResponse as any)?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('openai', model as any, toHeaderMap(hdrs))
            }
          } catch {}


          // Extract function calls from the output array and add them to conversation
          // If we already handled tool calls via streaming submitToolOutputs, skip this legacy path
          const toolCalls: Array<{ id: string; name: string; arguments: any }> = []
          if (!streamedToolActivity && Array.isArray(finalResponse?.output)) {
            for (const item of finalResponse.output) {

              if (item.type === 'function_call') {
                // Add the function call to the conversation input
                conv.push({
                  type: 'function_call',
                  call_id: item.call_id,
                  name: item.name,
                  arguments: item.arguments
                })

                // Also track it for execution
                toolCalls.push({
                  id: item.call_id,
                  name: item.name,
                  arguments: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
                })
              }
            }
          }


          if (toolCalls.length > 0) {
            // Execute tool calls sequentially to avoid rate limits
            let shouldPrune = false
            let pruneSummary: any = null

            // Per-turn dedupe: reuse identical tool results within this streamed turn
            const perTurnToolCache: Map<string, any> = new Map()

            for (const tc of toolCalls) {
              // Check for cancellation before executing each tool
              checkCancelled()

              const name = tc.name
              let tool: any = null
              try {
                tool = toolMap.get(name)
                if (!tool) {
                  conv.push({
                    type: 'function_call_output',
                    call_id: tc.id,
                    output: JSON.stringify({ error: `Tool ${name} not found` })
                  })
                  continue
                }
                const args = typeof (tc as any).arguments === 'string' ? (JSON.parse((tc as any).arguments || '{}') || {}) : ((tc as any).arguments || {})
                const schema = (tool as any)?.parameters
                const v = validateJson(schema, args)
                if (!v.ok) {
                  conv.push({
                    type: 'function_call_output',
                    call_id: tc.id,
                    output: JSON.stringify({ error: `Validation error: ${v.errors || 'invalid input'}` })
                  })
                  continue
                }

                // Generate tool execution ID
                // Use original tool name for events (not sanitized name)
                const originalName = tool?.name || String(name)
                const dedupeKey = `${originalName}:${JSON.stringify(args)}`
                // Notify start
                try { onToolStart?.({ callId: tc.id, name: originalName, arguments: args }) } catch {}

                // Execute tool with a defensive timeout (prevents hangs) and per-turn dedupe
                // Do not undercut tools that implement their own internal budget (e.g., workspace.search)
                // Heuristic: derive a minimum from the number of queries, and allow a provided hint to increase it
                const provided = (args && args.filters && typeof args.filters.timeBudgetMs === 'number') ? args.filters.timeBudgetMs : undefined
                const qCount = Array.isArray((args as any)?.queries) ? (args as any).queries.length : ((args as any)?.query ? 1 : 0)
                const estAuto = Math.min(30000, 10000 + Math.max(0, qCount - 1) * 1500) // mirrors tool's computeAutoBudget base/perTerm/cap
                const baseDefault = 15000
                const timeoutMs = Math.max(
                  5000, // never below 5s
                  Math.min(
                    30000, // hard cap
                    Math.max(
                      baseDefault,
                      provided ? (provided + 2000) : baseDefault, // give tools a little overhead beyond hint
                      estAuto + 1000 // leave breathing room beyond internal budget
                    )
                  )
                )
                let result: any
                if (perTurnToolCache.has(dedupeKey)) {
                  result = perTurnToolCache.get(dedupeKey)
                } else {

                result = await Promise.race([
                    Promise.resolve(tool.run(args, toolMeta)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool '${originalName}' timed out after ${timeoutMs}ms`)), timeoutMs))
                  ])
                  perTurnToolCache.set(dedupeKey, result)
                }

                // Notify end (full result to UI)
                try { onToolEnd?.({ callId: tc.id, name: originalName, result }) } catch {}

                // Check if tool requested pruning
                if (result?._meta?.trigger_pruning) {
                  shouldPrune = true
                  pruneSummary = result._meta.summary
                }

                // Format tool result (no special fsReadFile/fsReadLines handling)
                // Return raw tool result (no minification/compaction)
                const output: string = typeof result === 'string' ? result : JSON.stringify(result)
                conv.push({
                  type: 'function_call_output',
                  call_id: tc.id,
                  output
                })
              } catch (e: any) {
                // Check if this is a cancellation error
                if (e?.message?.includes('cancelled')) {
                  throw e
                }
                // Notify error
                try { onToolError?.({ callId: tc.id, name: (tool?.name || String(name)), error: e?.message || String(e) }) } catch {}
                conv.push({
                  type: 'function_call_output',
                  call_id: tc.id,
                  output: JSON.stringify({ error: e?.message || String(e) })
                })
              }
            }

            // Prune conversation if requested
            if (shouldPrune && pruneSummary) {
              pruneConversation(pruneSummary)
            }

            // Continue loop to request next streamed assistant turn
            continue
          }

          // Extract token usage from final response
          try {
            if (finalResponse?.usage) {
              const usage = {
                inputTokens: finalResponse.usage.input_tokens || 0,
                outputTokens: finalResponse.usage.output_tokens || 0,
                totalTokens: finalResponse.usage.total_tokens || 0,
              }
              cumulativeTokens += usage.totalTokens
              if (onTokenUsage) {
                onTokenUsage(usage)
              }
            }
          } catch (e) {
            // Token usage extraction failed
          }

          // Done - ALWAYS call onDone() to resolve promise
          onDone()
          return
        }
      } catch (e: any) {
        const msg = e?.message || ''
        if (e?.name === 'AbortError' || /cancel/i.test(msg)) {
          // Treat cooperative cancellation as a normal stop
          try { onDone() } catch {}
          return
        }
        const error = msg || String(e)
        onError(error)
        return
      }

      // If we exit the loop without returning (iteration limit or cancelled), call onDone
      // Loop exited normally (iteration limit or cancelled)
      onDone()
    }

    // Wait for run() to complete before returning
    await run().catch((e: any) => {
      try {
        const msg = e?.message || ''
        if (e?.name === 'AbortError' || /cancel/i.test(msg)) {
          // Swallow cancellation and signal done to resolve promise
          try { onDone() } catch {}
          return
        }
        const error = msg || String(e)
        onError(error)
      } catch {}
    })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  }
}
