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
  return messages.map((m) => ({ role: m.role as any, content: m.content }))
}

// Note: We no longer maintain session state for conversation chaining.
// The scheduler manages all conversation history and passes full message arrays.
// This makes providers stateless and simplifies context management.


export const OpenAIProvider: ProviderAdapter = {
  id: 'openai',

  // Plain chat (Responses API). We use non-stream + chunked emit for reliability; can be upgraded to true streaming.
  async chatStream({ apiKey, model, messages, emit: _emit, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    const holder: { stream?: any; cancelled?: boolean } = {}

    ;(async () => {
      try {
        // Stateless: just send the messages, no session chaining
        const stream: any = await withRetries(() => Promise.resolve(client.responses.stream({
          model,
          input: toResponsesInput(messages || []),
        })))
        holder.stream = stream
        try {
          // Generic streaming loop: consume deltas as they arrive
          for await (const evt of stream) {
            try {
              const type = evt?.type || ''
              let text: string | null = null

              if (typeof evt?.delta === 'string') {
                text = evt.delta
              } else if (typeof (evt as any)?.text === 'string') {
                text = (evt as any).text
              } else if (type?.includes('output_text') && typeof (evt as any)?.text === 'string') {
                text = (evt as any).text
              }

              if (text) {
                onChunk(text)
              }
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
            // Token usage extraction failed, continue anyway
          }
          // Update rate limit tracker based on response headers, if available
          try {
            const hdrs = (stream as any)?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('openai', model as any, toHeaderMap(hdrs))
            }
          } catch {}


          // Done
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
      }
    })().catch((e: any) => {
      // Handle any errors that occur after chatStream returns
      // This prevents unhandled promise rejections
      console.error('[OpenAIProvider] Unhandled error in chatStream:', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return {
      cancel: () => {
        holder.cancelled = true
        try { holder.stream?.controller?.abort?.() } catch {}
        try { holder.stream?.close?.() } catch {}
      },
    }
  },

  // Agent loop with tool-calling via Responses API
  async agentStream({ apiKey, model, messages, tools, responseSchema, emit: _emit, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
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
    let conv: Array<any> = (messages || [])
      .map((m) => ({ role: m.role, content: m.content || '' }))
      .filter(m => m.content !== '') // Remove messages with empty content

    let cancelled = false
    let iteration = 0
    let cumulativeTokens = 0

    // Helper to prune conversation when agent requests it
    const pruneConversation = (summary: any) => {
      const systemMsgs = (messages || []).filter(m => m.role === 'system')
      const recent = conv.slice(-5) // Keep last 5 messages

      const summaryMsg = {
        role: 'user' as const,
        content: formatSummary(summary),
      }

      // Rebuild conversation: system + summary + recent
      conv = [...systemMsgs.map(m => ({ role: m.role, content: m.content })), summaryMsg, ...recent]
    }

    const run = async () => {
      try {
        while (!cancelled && iteration < 50) { // Hard limit of 50 iterations as safety
          iteration++
          // Start a streaming turn; stream user-visible text as it comes, while accumulating any tool calls
          let useResponseFormat = !!responseSchema
          const mkOpts = (strict: boolean) => {
            const opts: any = {
              model,
              input: conv as any,
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
            stream = await withRetries(() => Promise.resolve(client.responses.stream(opts)))
            holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }
          } catch (err: any) {
            const msg = err?.message || ''
            if (useResponseFormat && (err?.status === 400 || /response_format|text\.format|json_schema|unsupported/i.test(msg))) {
              useResponseFormat = false
              stream = await withRetries(() => Promise.resolve(client.responses.stream(mkOpts(false))))
            } else {
              throw err
            }
          }

          // Buffer text chunks for this streamed turn. We'll decide after finalResponse
          // whether to emit to chat (only when there are NO tool calls in this turn).
          let turnBuffer = ''
          for await (const evt of stream) {
            try {
              const t = String(evt?.type || '')
              // Skip streaming tool/function argument deltas to chat; they will be handled via onToolStart/onToolEnd
              const isToolArgDelta = t.includes('function_call') || t.includes('tool') || t.includes('arguments')

              if (!isToolArgDelta) {
                let textToAdd = ''

                // Check different fields in priority order, but only use ONE per event

                // Use if-else to ensure we only take one field
                if (typeof (evt as any)?.delta === 'string' && (evt as any).delta) {
                  textToAdd = (evt as any).delta
                } else if (t.includes('output_text') && typeof (evt as any)?.text === 'string' && (evt as any).text) {
                  textToAdd = (evt as any).text
                } else if (typeof (evt as any)?.text === 'string' && (evt as any).text) {
                  textToAdd = (evt as any).text
                }

                // Add text if we got any
                if (textToAdd) {
                  // Skip if this would create a duplicate (text equals entire buffer so far)
                  if (textToAdd === turnBuffer) {
                  } else {
                    turnBuffer += textToAdd
                  }
                }
              }
            } catch (e: any) {
              const error = e?.message || String(e)
              onError(error)
            }
          }

          // After stream completes, get the final response with complete output array
          const finalResponse = await stream.finalResponse()
          // Update rate limit tracker from headers on streamed agent turn
          try {
            const hdrs = (stream as any)?.response?.headers || (finalResponse as any)?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('openai', model as any, toHeaderMap(hdrs))
            }
          } catch {}


          // Extract function calls from the output array and add them to conversation
          const toolCalls: Array<{ id: string; name: string; arguments: any }> = []
          if (Array.isArray(finalResponse?.output)) {
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

                // Minify heavy tool results before adding to conversation
                const { minifyToolResult } = await import('./toolResultMinify')
                const compact = minifyToolResult(originalName, result)
                const output = typeof compact === 'string' ? compact : JSON.stringify(compact)
                conv.push({
                  type: 'function_call_output',
                  call_id: tc.id,
                  output
                })
              } catch (e: any) {
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

          // No tool calls in this streamed turn -> emit buffered assistant text now
          if (turnBuffer) {
            try {
              onChunk(turnBuffer)
            } catch (e: any) {
              const error = e?.message || String(e)
              onError(error)
              return
            }
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
            console.error('[OpenAI agentStream] Error extracting token usage:', e)
          }

          // Done - ALWAYS call onDone() to resolve promise
          onDone()
          return
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        const error = e?.message || String(e)
        onError(error)
        return
      }

      // If we exit the loop without returning (iteration limit or cancelled), call onDone
      console.log('[OpenAI agentStream] Loop exited normally (iteration limit or cancelled)')
      onDone()
    }

    // Wait for run() to complete before returning
    await run().catch((e: any) => {
      console.error('[OpenAIProvider] Error in agentStream run():', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  }
}
