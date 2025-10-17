import OpenAI from 'openai'
import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'
import { formatSummary } from '../agent/types'

// Helper to map our ChatMessage[] to Responses API input format
function toResponsesInput(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role as any, content: m.content }))
}

// Tiny non-crypto hash for preamble/tool schemas
function hashStr(s: string): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16)
}

// In-memory conversation state keyed by sessionId for Responses API chaining and invalidation
const openAIConversations = new Map<string, { lastResponseId?: string; systemHash?: string; toolsHash?: string }>()


export const OpenAIProvider: ProviderAdapter = {
  id: 'openai',

  // Plain chat (Responses API). We use non-stream + chunked emit for reliability; can be upgraded to true streaming.
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError, onTokenUsage, onConversationMeta, sessionId }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    const holder: { stream?: any; cancelled?: boolean } = {}

      // Invalidate previous_response_id when preamble (system) changes
      try {
        const stateKey = sessionId || 'global'
        const systemText = (messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')) || ''
        const sysHash = hashStr(systemText)
        const st = openAIConversations.get(stateKey)
        if (!st || st.systemHash !== sysHash) {
          openAIConversations.set(stateKey, { lastResponseId: undefined, systemHash: sysHash, toolsHash: st?.toolsHash })
        }
      } catch {}

    ;(async () => {
      try {
        const stateKey = sessionId || 'global'
        const prev = openAIConversations.get(stateKey)?.lastResponseId
        const stream: any = await withRetries(() => Promise.resolve(client.responses.stream({
          model,
          input: toResponsesInput(messages),
          ...(prev ? { previous_response_id: prev } : {}),
        })))
        holder.stream = stream
        try {
          // Generic streaming loop: consume deltas as they arrive
          for await (const evt of stream) {
            try {
              const type = evt?.type || ''
              if (typeof evt?.delta === 'string') {
                onChunk(evt.delta)
              } else if (typeof (evt as any)?.text === 'string') {
                onChunk((evt as any).text)
              } else if (type?.includes('output_text') && typeof (evt as any)?.text === 'string') {
                onChunk((evt as any).text)
              }
            } catch (e: any) { onError(e?.message || String(e)) }
          }

          // Extract token usage from final response
          try {
            const finalResponse = await stream.finalResponse()
            // Persist response id for session chaining
            try {
              const stateKey = sessionId || 'global'
              if (finalResponse?.id) {
                const prevState = openAIConversations.get(stateKey) || {}
                openAIConversations.set(stateKey, { ...prevState, lastResponseId: String(finalResponse.id) })
              }
            } catch {}
            // Emit conversation meta so renderer can persist
            try {
              const sysText = (messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')) || ''
              onConversationMeta?.({ provider: 'openai', sessionId, lastResponseId: String(finalResponse?.id || ''), preambleHash: hashStr(sysText) })
            } catch {}
            if (finalResponse?.usage && onTokenUsage) {
              const usage = {
                inputTokens: finalResponse.usage.input_tokens || 0,
                outputTokens: finalResponse.usage.output_tokens || 0,
                totalTokens: finalResponse.usage.total_tokens || 0,
              }
              onTokenUsage(usage)
            } else {
            }
          } catch (e) {
            // Token usage extraction failed, continue anyway
          }

          onDone()
        } catch (e: any) {
          if (e?.name === 'AbortError') return
          onError(e?.message || String(e))
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        onError(e?.message || String(e))
      }
    })().catch((e: any) => {
      // Handle any errors that occur after chatStream returns
      // This prevents unhandled promise rejections
      console.error('[OpenAIProvider] Unhandled error in chatStream:', e)
      try {
        onError(e?.message || String(e))
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
  async agentStream({ apiKey, model, messages, tools, responseSchema, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError, onConversationMeta, sessionId }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    // Validate tools array
    if (!Array.isArray(tools)) {
      onError('Tools must be an array')
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
    let conv: Array<any> = messages
      .map((m) => ({ role: m.role, content: m.content || '' }))
      .filter(m => m.content !== '') // Remove messages with empty content

    let cancelled = false
    let iteration = 0
    let cumulativeTokens = 0

    // Helper to prune conversation when agent requests it
    const pruneConversation = (summary: any) => {
      const systemMsgs = messages.filter(m => m.role === 'system')
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

          // Invalidate previous_response_id when system/tools change (agent mode)
          try {
            const stateKey = sessionId || 'global'
            const systemText = (messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')) || ''
            const sysHash = hashStr(systemText)
            const toolsHash = hashStr(JSON.stringify(oaTools))
            const st = openAIConversations.get(stateKey)
            if (!st || st.systemHash !== sysHash || st.toolsHash !== toolsHash) {
              openAIConversations.set(stateKey, { lastResponseId: undefined, systemHash: sysHash, toolsHash })
            }
          } catch {}

          let stream: any
          try {
            const opts = mkOpts(useResponseFormat)
            // Chain with previous response when available for this session
            try {
              const stateKey = sessionId || 'global'
              const prev = openAIConversations.get(stateKey)?.lastResponseId
              if (prev) (opts as any).previous_response_id = prev
            } catch {}
            stream = await withRetries(() => Promise.resolve(client.responses.stream(opts)))
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
            } catch (e: any) { onError(e?.message || String(e)) }
          }

          // After stream completes, get the final response with complete output array
          const finalResponse = await stream.finalResponse()
          // Persist response id for session chaining
          try {
            const stateKey = sessionId || 'global'
            if (finalResponse?.id) {
              const prevState = openAIConversations.get(stateKey) || {}
              openAIConversations.set(stateKey, { ...prevState, lastResponseId: String(finalResponse.id) })
            }
          } catch {}
          // Emit conversation meta so renderer can persist
          try {
            const sysText = (messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')) || ''
            onConversationMeta?.({ provider: 'openai', sessionId, lastResponseId: String(finalResponse?.id || ''), preambleHash: hashStr(sysText) })
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

            for (const tc of toolCalls) {
              try {
                const name = tc.name
                const tool = toolMap.get(name)
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

                // Notify start, then execute tool (pass toolMeta)
                try { onToolStart?.({ callId: tc.id, name: String(name), arguments: args }) } catch {}
                const result = await Promise.resolve(tool.run(args, toolMeta))
                try { onToolEnd?.({ callId: tc.id, name: String(name), result }) } catch {}

                // Check if tool requested pruning
                if (result?._meta?.trigger_pruning) {
                  shouldPrune = true
                  pruneSummary = result._meta.summary
                }

                const output = typeof result === 'string' ? result : JSON.stringify(result)
                conv.push({
                  type: 'function_call_output',
                  call_id: tc.id,
                  output
                })
              } catch (e: any) {
                try { onToolError?.({ callId: tc.id, name: String(name), error: e?.message || String(e) }) } catch {}
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
            try { onChunk(turnBuffer) } catch (e: any) { onError(e?.message || String(e)) }
          }
          // Extract token usage from final response
          try {
            if (finalResponse?.usage && onTokenUsage) {
              const usage = {
                inputTokens: finalResponse.usage.input_tokens || 0,
                outputTokens: finalResponse.usage.output_tokens || 0,
                totalTokens: finalResponse.usage.total_tokens || 0,
              }
              cumulativeTokens += usage.totalTokens
              onTokenUsage(usage)
            } else {
            }
          } catch (e) {
            console.error('[OpenAI agentStream] Error extracting token usage:', e)
          }

          onDone()
          return
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        onError(e?.message || String(e))
      }
    }

    run().catch((e: any) => {
      // Handle any errors that occur after agentStream returns
      // This prevents unhandled promise rejections
      console.error('[OpenAIProvider] Unhandled error in agentStream run():', e)
      try {
        onError(e?.message || String(e))
      } catch {}
    })

    return { cancel: () => { cancelled = true } }
  }
}
