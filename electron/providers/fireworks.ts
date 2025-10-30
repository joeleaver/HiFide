import OpenAI from 'openai'
import { logProviderHttp, shouldLogProviderHttp } from './provider'

import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'
import { formatSummary } from '../agent/types'

import { rateLimitTracker } from './rate-limit-tracker'
import { createCallbackEventEmitters } from '../ipc/flows-v2/execution-events'

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


export const FireworksProvider: ProviderAdapter = {
  id: 'fireworks',

  // Agent loop with tool-calling via Responses API
  async agentStream({ apiKey, model, messages, temperature, reasoningEffort, tools, responseSchema, emit: _emit, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.fireworks.ai/inference/v1' })

    const holder: { abort?: () => void } = {}

    // Validate tools array
    if (!Array.isArray(tools)) {
      const error = 'Tools must be an array'
      try { onError(error) } catch {}
      return { cancel: () => {} }
    }

    // Map internal tools to Fireworks Responses tool format (sanitize names)
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

    const fwTools: any[] = tools
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
    const DEBUG_HTTP = shouldLogProviderHttp()
    const DEBUG_FULL = process.env.HF_LOG_LLM_FULL === '1'
    const __streamEvents: any[] | undefined = DEBUG_FULL ? [] : undefined

    // Responses API uses a different format than Chat Completions
    // Input can be: { role, content } OR { type, call_id, output } for function results
    const { instructions, input: initialInput } = splitInstructions(messages || [])
    let conv: Array<any> = (initialInput || [])
      .map((m) => ({ role: m.role, content: m.content || '' }))
      .filter(m => m.content !== '') // Remove messages with empty content

    let cancelled = false
    let iteration = 0
    let cumulativeTokens = 0
    // Bridge legacy callbacks to unified execution events if emit() is provided
    const emitters = _emit ? createCallbackEventEmitters(_emit, 'fireworks', String(model)) : null
    const emitChunk = (text: string) => { try { onChunk(text) } catch {} ; try { emitters?.onChunk(text) } catch {} }
    const emitDone = () => { try { onDone() } catch {} ; try { emitters?.onDone() } catch {} }
    const emitError = (err: string) => { try { onError(err) } catch {} ; try { emitters?.onError(err) } catch {} }
    const emitUsage = (usage: any) => { try { onTokenUsage?.(usage) } catch {} ; try { emitters?.onTokenUsage(usage) } catch {} }
    const emitToolStart = (ev: { callId?: string; name: string; arguments?: any }) => { try { onToolStart?.(ev) } catch {} ; try { emitters?.onToolStart(ev) } catch {} }
    const emitToolEnd = (ev: { callId?: string; name: string; result?: any }) => { try { onToolEnd?.(ev) } catch {} ; try { emitters?.onToolEnd(ev) } catch {} }
    const emitToolError = (ev: { callId?: string; name: string; error: string }) => { try { onToolError?.(ev) } catch {} ; try { emitters?.onToolError(ev) } catch {} }


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
            const opts: any = {
              model,
              input: conv as any,
            }
            if (instructions) {
              opts.instructions = instructions
            }
            // Note: Fireworks may not support reasoningEffort yet, but we include it for future compatibility
            if (reasoningEffort) {
              opts.reasoning = { effort: reasoningEffort }
            }
            if (typeof temperature === 'number') {
              opts.temperature = temperature
            }
            // Only add tools if we have valid tools
            if (fwTools.length > 0) {
              opts.tools = fwTools
              // Default to auto tool choice
              let choice: any = 'auto'
              const requested = (toolMeta as any)?.toolChoice
              if (requested) {
                const req = String(requested)
                if (req === 'none' || req === 'auto' || req === 'required') {
                  choice = req
                } else {
                  // Treat as specific tool name; map to sanitized name if we have it
                  const nameSafe = toSafeName(req)
                  // Fireworks Responses likely accepts { type: 'function', name }
                  choice = { type: 'function', name: nameSafe }
                }
              }
              opts.tool_choice = choice
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
              logProviderHttp({ provider: 'fireworks', method: 'POST', url: 'https://api.fireworks.ai/inference/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, body: opts })
              stream = await withRetries(() => Promise.resolve(client.responses.stream(opts)))
            } catch (err: any) {
              const msg = String(err?.message || err)
              // Tolerate model-specific unsupported params by stripping and retrying once
              let retried = false
              if (/Unsupported parameter/i.test(msg)) {
                if (/temperature/i.test(msg)) { try { delete (opts as any).temperature } catch {} ; retried = true }
                if (/reasoning/i.test(msg) || /effort/i.test(msg)) { try { delete (opts as any).reasoning } catch {} ; retried = true }
                if (/tool_choice/i.test(msg)) { try { delete (opts as any).tool_choice } catch {} ; retried = true }
                // Some models may not support tools at all
                if (/tools/i.test(msg)) { try { delete (opts as any).tools; delete (opts as any).tool_choice } catch {} ; retried = true }
              }
              if (retried) {
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
              logProviderHttp({ provider: 'fireworks', method: 'POST', url: 'https://api.fireworks.ai/inference/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, body: mkOpts(false) })
              stream = await withRetries(() => Promise.resolve(client.responses.stream(mkOpts(false))))
            } else {
              throw err
            }
          }

          // Track streaming tool calls (single-request handshake if SDK supports it)
          const pendingArgs: Map<string, { name: string; buf: string }> = new Map()
          let streamedToolActivity = false
          const canSubmitToolOutputs = typeof (stream as any)?.submitToolOutputs === 'function'

          // Track which output items are active (messages vs tool calls) by output_index/id
          const activeItems = new Map<string, { type: string; role?: string }>()

          for await (const evt of stream) {
            try {
              const t = String(evt?.type || '')
              // Capture raw SSE events for full HTTP body reconstruction when enabled
              if (DEBUG_FULL && __streamEvents) {
                try {
                  __streamEvents.push(JSON.parse(JSON.stringify(evt)))
                } catch {
                  __streamEvents.push({ type: t })
                }
              }

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
                    try { emitToolStart({ callId, name: toolMap.get(String(name || ''))?.name || String(name || '') }) } catch {}
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
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: `Tool ${name} not found` }) }]) } catch {}
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                const schema = (tool as any)?.parameters
                const v = validateJson(schema, argsObj)
                if (!v.ok) {
                  streamedToolActivity = true
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: `Validation error: ${v.errors || 'invalid input'}` }) }]) } catch {}
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                let result: any
                try {
                  result = await Promise.resolve(tool.run(argsObj, toolMeta))
                  try { emitToolEnd({ callId, name: tool?.name || name, result }) } catch {}
                } catch (err: any) {
                  const errMsg = err?.message || String(err)
                  try { emitToolError({ callId, name: tool?.name || name, error: errMsg }) } catch {}
                  streamedToolActivity = true
                  try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output: JSON.stringify({ error: errMsg }) }]) } catch {}
                  if (callId) pendingArgs.delete(callId)
                  continue
                }

                // Format output (raw for read_file/lines; otherwise minified JSON)
                let output: string = ''
                try {
                  const originalName = tool?.name || name
                  const cname = String(originalName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
                  if (cname === 'workspacesearch' && (args as any)?.action === 'expand') {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    output = typeof d?.preview === 'string' ? d.preview : (typeof d?.data?.preview === 'string' ? d.data.preview : '')
                  } else if (cname === 'workspacejump') {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    output = typeof d?.preview === 'string' ? d.preview : (typeof d?.data?.preview === 'string' ? d.data.preview : '')
                  } else if (cname === 'textgrep') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      const m = Array.isArray(d?.matches) && d.matches.length ? d.matches[0] : null
                      if (m) {
                        const before = Array.isArray(m.before) ? m.before : []
                        const after = Array.isArray(m.after) ? m.after : []
                        const lines = [...before, (m.line ?? ''), ...after]
                        output = lines.join('\n')
                      } else {
                        output = ''
                      }
                    }
                  } else if (cname === 'codesearchast' || cname === 'astgrepsearch' || cname === 'codeastgrep' || cname === 'astgrep') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      const m = Array.isArray(d?.matches) && d.matches.length ? d.matches[0] : null
                      output = m ? String(m.snippet || m.text || '') : ''
                    }
                  } else if (cname === 'indexsearch') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      const chunks = Array.isArray(d?.chunks) ? d.chunks : (Array.isArray(d?.data?.chunks) ? d.data.chunks : [])
                      const c0 = chunks && chunks.length ? chunks[0] : null
                      output = c0 && typeof c0.text === 'string' ? c0.text : ''
                    }
                  } else if (cname === 'terminalsessiontail') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      output = typeof d?.tail === 'string' ? d.tail : (typeof d?.data?.tail === 'string' ? d.data.tail : '')
                    }
                  } else if (cname === 'terminalsessionsearchoutput') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      const h0 = Array.isArray(d?.hits) ? d.hits[0] : (Array.isArray(d?.data?.hits) ? d.data.hits[0] : null)
                      output = h0 ? String(h0.snippet || '') : ''
                    }
                  } else if (cname === 'knowledgebasesearch' || cname === 'kbsearch') {
                    if (result && (result as any).ok === false) {
                      output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                    } else {
                      const d: any = result && (result as any).data ? (result as any).data : result
                      const r0 = Array.isArray(d?.results) ? d.results[0] : (Array.isArray(d?.data?.results) ? d.data.results[0] : null)
                      output = r0 ? String(r0.excerpt || '') : ''
                    }
                  } else {
                    output = typeof result === 'string' ? result : JSON.stringify(result)
                  }
                } catch {
                  output = typeof result === 'string' ? result : JSON.stringify(result)
                }

                streamedToolActivity = true
                try { await (stream as any).submitToolOutputs?.([{ call_id: callId, output }]) } catch {}
                if (callId) pendingArgs.delete(callId)
                continue
              }

              // Strictly print only output text stream events
              if (t === 'response.output_text.delta') {
                const delta = (evt as any)?.delta
                if (typeof delta === 'string' && delta) {
                  // Log raw chunk output exactly as received from Fireworks
                  try { console.log('[Fireworks] raw output_text.delta:', delta) } catch {}
                  try { emitChunk(delta) } catch (e) { try { emitError(String(e)) } catch {} }
                }
                continue
              }
              if (t === 'response.output_text.done') {
                // no-op; end of text streaming for current item
                continue
              }
            } catch (e: any) {
              const error = e?.message || String(e)
              emitError(error)
            }
          }

          // After stream completes, get the final response with complete output array
          const finalResponse = await stream.finalResponse()

          // Log entire HTTP response: headers + final payload (safe extract)
          try {
            const hdrs = (stream as any)?.response?.headers || (finalResponse as any)?.response?.headers
            const headersMap = hdrs ? toHeaderMap(hdrs) : undefined
            if (DEBUG_HTTP) {
              logProviderHttp({
                provider: 'fireworks',
                method: 'POST',
                url: 'https://api.fireworks.ai/inference/v1/responses',
                headers: headersMap,
                body: finalResponse,
                note: 'Response'
              })
            }
            // Always print a concise version to console for quick inspection
            try { if (headersMap) console.log('[Fireworks] HTTP response headers:', headersMap) } catch {}
            try {
              const safeFinal: any = {
                id: (finalResponse as any)?.id,
                usage: (finalResponse as any)?.usage,
                output: (finalResponse as any)?.output
              }
              console.log('[Fireworks] HTTP finalResponse (safe extract):', JSON.stringify(safeFinal, null, 2))
            } catch {}
            // If full logging is requested, dump all SSE events captured during streaming
            if (DEBUG_FULL && __streamEvents && __streamEvents.length) {
              console.log(`[Fireworks] HTTP stream SSE events (${__streamEvents.length})`) // summary
              for (const ev of __streamEvents) {
                try { console.log('[Fireworks] SSE event:', JSON.stringify(ev)) } catch { console.log('[Fireworks] SSE event type:', String((ev as any)?.type || '')) }
              }
            }
            // Update rate limit tracker from headers on streamed agent turn
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('fireworks' as any, model as any, toHeaderMap(hdrs))
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
                try { emitToolStart({ callId: tc.id, name: originalName, arguments: args }) } catch {}

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
                  // Prefer raw code blocks for read_lines to help LLM comprehension

                result = await Promise.race([
                    Promise.resolve(tool.run(args, toolMeta)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool '${originalName}' timed out after ${timeoutMs}ms`)), timeoutMs))
                  ])
                  perTurnToolCache.set(dedupeKey, result)
                }

                // Notify end (full result to UI)
                try { emitToolEnd({ callId: tc.id, name: originalName, result }) } catch {}

                // Check if tool requested pruning
                if (result?._meta?.trigger_pruning) {
                  shouldPrune = true
                  pruneSummary = result._meta.summary
                }

                // For fs.read_file and fs.read_lines, return RAW text with no minification/JSON
                let output: string
                const cname = String(originalName || '').toLowerCase().replace(/[^a-z0-9]/g, '')

                if (cname === 'workspacesearch' && (args as any)?.action === 'expand') {
                  const d: any = result && (result as any).data ? (result as any).data : result
                  output = typeof d?.preview === 'string' ? d.preview : (typeof d?.data?.preview === 'string' ? d.data.preview : '')
                } else if (cname === 'workspacejump') {
                  const d: any = result && (result as any).data ? (result as any).data : result
                  output = typeof d?.preview === 'string' ? d.preview : (typeof d?.data?.preview === 'string' ? d.data.preview : '')
                } else if (cname === 'textgrep') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    const m = Array.isArray(d?.matches) && d.matches.length ? d.matches[0] : null
                    if (m) {
                      const before = Array.isArray(m.before) ? m.before : []
                      const after = Array.isArray(m.after) ? m.after : []
                      const lines = [...before, (m.line ?? ''), ...after]
                      output = lines.join('\n')
                    } else {
                      output = ''
                    }
                  }
                } else if (cname === 'codesearchast' || cname === 'astgrepsearch' || cname === 'codeastgrep' || cname === 'astgrep') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    const m = Array.isArray(d?.matches) && d.matches.length ? d.matches[0] : null
                    output = m ? String(m.snippet || m.text || '') : ''
                  }
                } else if (cname === 'indexsearch') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    const chunks = Array.isArray(d?.chunks) ? d.chunks : (Array.isArray(d?.data?.chunks) ? d.data.chunks : [])
                    const c0 = chunks && chunks.length ? chunks[0] : null
                    output = c0 && typeof c0.text === 'string' ? c0.text : ''
                  }
                } else if (cname === 'terminalsessiontail') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    output = typeof d?.tail === 'string' ? d.tail : (typeof d?.data?.tail === 'string' ? d.data.tail : '')
                  }
                } else if (cname === 'terminalsessionsearchoutput') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    const h0 = Array.isArray(d?.hits) ? d.hits[0] : (Array.isArray(d?.data?.hits) ? d.data.hits[0] : null)
                    output = h0 ? String(h0.snippet || '') : ''
                  }
                } else if (cname === 'knowledgebasesearch' || cname === 'kbsearch') {
                  if (result && (result as any).ok === false) {
                    output = `Error: ${String((result as any)?.error || 'Unknown error')}`
                  } else {
                    const d: any = result && (result as any).data ? (result as any).data : result
                    const r0 = Array.isArray(d?.results) ? d.results[0] : (Array.isArray(d?.data?.results) ? d.data.results[0] : null)
                    output = r0 ? String(r0.excerpt || '') : ''
                  }
                } else {
                  // Standard minification for all other tools including fsRead* now returning strings
                  output = typeof result === 'string' ? result : JSON.stringify(result)
                }
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
                try { emitToolError({ callId: tc.id, name: (tool?.name || String(name)), error: e?.message || String(e) }) } catch {}
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
              emitUsage(usage)
            }
          } catch (e) {
            // Token usage extraction failed
          }

          // Done - ALWAYS call onDone() to resolve promise
          emitDone()
          return
        }
      } catch (e: any) {
        const msg = e?.message || ''
        if (e?.name === 'AbortError' || /cancel/i.test(msg)) {
          // Treat cooperative cancellation as a normal stop
          try { emitDone() } catch {}
          return
        }
        const error = msg || String(e)
        emitError(error)
        return
      }

      // If we exit the loop without returning (iteration limit or cancelled), call onDone
      // Loop exited normally (iteration limit or cancelled)
      emitDone()
    }

    // Wait for run() to complete before returning
    await run().catch((e: any) => {
      try {
        const msg = e?.message || ''
        if (e?.name === 'AbortError' || /cancel/i.test(msg)) {
          // Swallow cancellation and signal done to resolve promise
          try { emitDone() } catch {}
          return
        }
        const error = msg || String(e)
        emitError(error)
      } catch {}
    })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  }
}


