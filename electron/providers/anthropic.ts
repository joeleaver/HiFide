import Anthropic from '@anthropic-ai/sdk'
import type { ProviderAdapter, StreamHandle, AgentTool } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'
import { formatSummary } from '../agent/types'

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

import { rateLimitTracker } from './rate-limit-tracker'

// Note: Anthropic has always been stateless - it requires full message history every time.
// This is now consistent with our architecture where the scheduler manages all conversation state.

export const AnthropicProvider: ProviderAdapter = {
  id: 'anthropic',

  async chatStream({ apiKey, model, system, messages, emit: _emit, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
    const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' } as any })

    // Messages are already formatted by llm-service
    // system: array of content blocks with cache_control
    // messages: array of {role: 'user'|'assistant', content: string}

    const holder: { abort?: () => void } = {}

    ;(async () => {
      try {
        const stream: any = await withRetries(() => client.messages.create({
          model,
          system: system || undefined,
          messages: messages as any,
          stream: true,
          max_tokens: 8192 // Increased from 2048 to allow longer responses
        }) as any)
        holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }

        let usage: any = null

        for await (const evt of stream) {
          try {
            if (evt?.type === 'content_block_delta') {
              const t = evt?.delta?.text
              if (t) {
                const text = String(t)
                onChunk(text)
              }
            } else if (evt?.type === 'message_start') {
              // Capture usage from message_start event
              usage = evt?.message?.usage
            } else if (evt?.type === 'message_delta') {
              // Update usage from message_delta event
              if (evt?.usage) usage = evt.usage

            } else if (evt?.type === 'message_stop') {
              // end of stream
            }
          } catch (e: any) {
            const error = e?.message || String(e)
            onError(error)
          }
        }

        // Report token usage if available
        if (usage) {
          const tokenUsage = {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          }
          if (onTokenUsage) onTokenUsage(tokenUsage)
        }
        // Update rate limit tracker from headers if available (success path)
        try {
          const hdrs = (stream as any)?.response?.headers || (stream as any)?.raw?.response?.headers || (stream as any)?.controller?.response?.headers
          if (hdrs) {
            rateLimitTracker.updateFromHeaders('anthropic', model as any, toHeaderMap(hdrs))
          }
        } catch {}


        // Done
        onDone()
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        const error = e?.message || String(e)
        onError(error)

      }
    })().catch((e: any) => {
      console.error('[AnthropicProvider] Unhandled error in chatStream:', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with tool-calling using Anthropic Messages API
  async agentStream({ apiKey, model, system, messages, tools, responseSchema: _responseSchema, emit: _emit, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' } as any })

    const holder: { abort?: () => void } = {}

    // Map tools to Anthropic format (sanitize names to match pattern ^[a-zA-Z0-9_-]{1,128}$)
    const toolMap = new Map<string, AgentTool>()
    const usedNames = new Set<string>()
    const toSafeName = (name: string) => {
      // Replace invalid characters (dots, spaces, etc.) with underscores
      let safe = (name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')
      if (!safe) safe = 'tool'
      // Handle duplicates
      let base = safe, i = 1
      while (usedNames.has(safe)) { i += 1; safe = `${base}_${i}` }
      usedNames.add(safe)
      return safe
    }

    const anthTools = tools
      .filter(t => t && t.name) // Filter out invalid tools
      .map((t) => {
        const safeName = toSafeName(t.name)
        toolMap.set(safeName, t) // Map safe name to original tool
        return { name: safeName, description: t.description || undefined, input_schema: t.parameters as any }
      }) as any

    // Optional cached tool preamble block for stable tool schemas
    const toolsDesc = (anthTools && anthTools.length)
      ? 'Available tools:\n' + anthTools.map((t: any) => `- ${t.name}${t.description ? ': ' + t.description : ''}`).join('\n')
      : ''
    const toolBlocks: any = toolsDesc ? [{ type: 'text', text: toolsDesc, cache_control: { type: 'ephemeral' } }] : undefined

    // Combine system blocks (already formatted by llm-service) with tool blocks
    const systemAllBlocks: any[] = [ ...(system || []), ...((toolBlocks as any) || []) ]

    // Messages are already formatted by llm-service as {role: 'user'|'assistant', content: string}[]
    let conv: any[] = messages as any[]
    let cancelled = false
    let iteration = 0

    // Helper to prune conversation when agent requests it
    const pruneConversation = (summary: any) => {
            const recent = conv.slice(-5) // Keep last 5 messages

      const summaryMsg = {
        role: 'user' as const,
        content: formatSummary(summary),
      }

      // Rebuild conversation: system + summary + recent
      conv = [summaryMsg, ...recent]

    }

    const run = async () => {
      try {
        let totalUsage: any = null

        while (!cancelled && iteration < 50) { // Hard limit of 50 iterations as safety
          iteration++

          console.log(`[Anthropic] Starting iteration ${iteration}:`, {
            model,
            hasSystem: !!(systemAllBlocks && systemAllBlocks.length),
            messageCount: conv.length,
            toolCount: anthTools.length,
            toolNames: anthTools.map((t: any) => t.name)
          })

          // Stream an assistant turn and capture any tool_use blocks while streaming
          const stream: any = await withRetries(() => client.messages.create({
            model: model as any,
            system: (systemAllBlocks && systemAllBlocks.length) ? (systemAllBlocks as any) : undefined,
            messages: conv as any,
            tools: anthTools.length ? anthTools : undefined,
            stream: true,
            max_tokens: 8192, // Increased from 2048 to allow longer responses and tool calls
          }) as any)
          holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }

          // Accumulate tool_use inputs incrementally and track usage
          const active: Record<string, { id: string; name: string; inputText: string }> = {}
          const completed: Array<{ id: string; name: string; input: any }> = []
          let usage: any = null
          // Map index to id for tracking tool inputs (since delta events only have index, not id)
          const indexToId: Record<number, string> = {}

          for await (const evt of stream) {
            try {
              if (evt?.type === 'content_block_delta') {
                // Handle text deltas
                if (evt?.delta?.type === 'text_delta') {
                  const t = evt?.delta?.text
                  if (t) {
                    const text = String(t)
                    onChunk(text)
                  }
                }
                // Handle tool input JSON deltas
                else if (evt?.delta?.type === 'input_json_delta') {
                  const index = evt?.index
                  const id = index !== undefined ? indexToId[index] : undefined
                  const chunk = evt?.delta?.partial_json || ''
                  if (id && active[id]) {
                    active[id].inputText += chunk
                    console.log(`[Anthropic] Accumulating tool input:`, {
                      id,
                      chunkLength: chunk.length,
                      totalLength: active[id].inputText.length
                    })
                  } else if (index !== undefined && !id) {
                    console.warn(`[Anthropic] Received input_json_delta for unknown index:`, { index, chunk })
                  }
                }
              } else if (evt?.type === 'content_block_start' && evt?.content_block?.type === 'tool_use') {
                const id = evt?.content_block?.id
                const name = evt?.content_block?.name
                const index = evt?.index
                console.log(`[Anthropic] Tool use started:`, { id, name, index })
                if (id && name) {
                  active[id] = { id, name, inputText: '' }
                  if (index !== undefined) {
                    indexToId[index] = id
                  }
                }
              } else if (evt?.type === 'content_block_stop') {
                const index = evt?.index
                const id = index !== undefined ? indexToId[index] : undefined
                const item = id ? active[id] : undefined
                console.log(`[Anthropic] Content block stop:`, { index, id, hasItem: !!item })
                if (item) {
                  let parsed: any = {}
                  try {
                    parsed = item.inputText ? JSON.parse(item.inputText) : {}
                    console.log(`[Anthropic] Parsed tool input:`, {
                      toolName: item.name,
                      inputText: item.inputText,
                      parsed
                    })
                  } catch (e) {
                    console.error(`[Anthropic] Failed to parse tool input:`, {
                      toolName: item.name,
                      inputText: item.inputText,
                      error: e
                    })
                  }
                  completed.push({ id: item.id, name: item.name, input: parsed })
                  if (id !== undefined) {
                    delete active[id]
                  }
                }
              } else if (evt?.type === 'message_start') {
                // Capture usage from message_start event
                usage = evt?.message?.usage
              } else if (evt?.type === 'message_delta') {
                // Update usage from message_delta event
                if (evt?.usage) usage = evt.usage
              } else if (evt?.type === 'message_stop') {
                console.log(`[Anthropic] Message stop event received`)
              }
            } catch (e: any) {
              console.error(`[Anthropic] Error processing stream event:`, {
                eventType: evt?.type,
                error: e?.message || String(e),
                stack: e?.stack
              })
              const error = e?.message || String(e)
              onError(error)
            }
          }

          console.log(`[Anthropic] Stream ended:`, {
            completedTools: completed.length,
            activeTools: Object.keys(active).length,
            iteration
          })
          // Update rate limit tracker from headers if available for this streamed turn
          try {
            const hdrs = (stream as any)?.response?.headers || (stream as any)?.raw?.response?.headers || (stream as any)?.controller?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('anthropic', model as any, toHeaderMap(hdrs))
            }
          } catch {}


          // Check for incomplete tool calls that never received content_block_stop
          const activeToolIds = Object.keys(active)
          if (activeToolIds.length > 0) {
            console.error(`[Anthropic] Stream ended with incomplete tool calls:`, {
              activeTools: activeToolIds.map(id => ({
                id,
                name: active[id].name,
                inputLength: active[id].inputText.length,
                inputPreview: active[id].inputText.substring(0, 100)
              }))
            })
            // Try to parse and complete any incomplete tool calls
            for (const id of activeToolIds) {
              const item = active[id]
              let parsed: any = {}
              try {
                parsed = item.inputText ? JSON.parse(item.inputText) : {}
                console.log(`[Anthropic] Recovered incomplete tool call:`, {
                  toolName: item.name,
                  inputText: item.inputText,
                  parsed
                })
                completed.push({ id: item.id, name: item.name, input: parsed })
              } catch (e) {
                console.error(`[Anthropic] Failed to parse incomplete tool input:`, {
                  toolName: item.name,
                  inputText: item.inputText,
                  error: e
                })
                // Add error result for this incomplete tool call
                completed.push({
                  id: item.id,
                  name: item.name,
                  input: { _error: 'Incomplete tool call - stream ended before completion' }
                })
              }
            }
          }

          // Accumulate usage across multiple turns
          if (usage) {
            if (!totalUsage) {
              totalUsage = usage
            } else {
              totalUsage.input_tokens = (totalUsage.input_tokens || 0) + (usage.input_tokens || 0)
              totalUsage.output_tokens = (totalUsage.output_tokens || 0) + (usage.output_tokens || 0)
            }
          }

          if (completed.length > 0) {
            console.log(`[Anthropic] Tool calls detected:`, {
              toolCount: completed.length,
              tools: completed.map(t => ({ name: t.name, id: t.id }))
            })

            // Reconstruct assistant content with tool_use blocks for the transcript context
            const assistantBlocks = completed.map(tu => ({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input }))
            conv.push({ role: 'assistant', content: assistantBlocks as any })

            // Execute tools and add tool_result blocks
            const results: any[] = []
            let shouldPrune = false
            let pruneSummary: any = null

            for (const tu of completed) {
              try {
                console.log(`[Anthropic] Executing tool:`, {
                  sanitizedName: tu.name,
                  toolId: tu.id,
                  inputPreview: JSON.stringify(tu.input).substring(0, 100)
                })

                const tool = toolMap.get(tu.name)
                if (!tool) {
                  console.error(`[Anthropic] Tool not found in toolMap:`, {
                    sanitizedName: tu.name,
                    availableTools: Array.from(toolMap.keys())
                  })
                  results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: Tool ${tu.name} not found`, is_error: true })
                  continue
                }

                // Use original tool name for events (not sanitized name)
                const originalToolName = tool.name
                console.log(`[Anthropic] Found tool:`, {
                  sanitizedName: tu.name,
                  originalName: originalToolName
                })

                const schema = (tool as any)?.parameters
                const v = validateJson(schema, tu.input)
                if (!v.ok) {
                  results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Validation error: ${v.errors || 'invalid input'}`, is_error: true })
                  continue
                }

                // Notify tool start (use original name for UI display)
                try { onToolStart?.({ callId: tu.id, name: originalToolName, arguments: tu.input }) } catch {}

                console.log(`[Anthropic] Running tool:`, { originalName: originalToolName })

                // Pass toolMeta to tool.run()
                const result = await Promise.resolve(tool.run(tu.input, toolMeta))

                console.log(`[Anthropic] Tool completed:`, {
                  originalName: originalToolName,
                  resultPreview: typeof result === 'string' ? result.substring(0, 100) : JSON.stringify(result).substring(0, 100)
                })

                // Notify tool end (use original name for UI display) with full result (for UI badges/state)
                try { onToolEnd?.({ callId: tu.id, name: originalToolName, result }) } catch {}

                // Check if tool requested pruning
                if (result?._meta?.trigger_pruning) {
                  shouldPrune = true
                  pruneSummary = result._meta.summary
                }

                // IMPORTANT: Minify heavy tool results before adding to conversation to avoid memory blowups
                const { minifyToolResult } = await import('./toolResultMinify')
                const compact = minifyToolResult(originalToolName, result)
                results.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof compact === 'string' ? compact : JSON.stringify(compact) })
              } catch (e: any) {
                // Get original tool name for error reporting
                const tool = toolMap.get(tu.name)
                const originalToolName = tool?.name || tu.name

                // Notify tool error (use original name for UI display)
                try { onToolError?.({ callId: tu.id, name: originalToolName, error: e?.message || String(e) }) } catch {}
                results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e?.message || String(e)}`, is_error: true })
              }
            }
            conv.push({ role: 'user', content: results })

            console.log(`[Anthropic] Tool results added to conversation, continuing agentic loop...`, {
              iteration,
              resultCount: results.length
            })

            // Prune conversation if requested
            if (shouldPrune && pruneSummary) {
              pruneConversation(pruneSummary)
            }

            continue
          }

          // No tool_use in this streamed turn; we already streamed the final text
          console.log(`[Anthropic] No tool calls in this turn, ending agentic loop`, {
            iteration,
            totalIterations: iteration
          })

          // Report accumulated token usage
          if (totalUsage) {
            const tokenUsage = {
              inputTokens: totalUsage.input_tokens || 0,
              outputTokens: totalUsage.output_tokens || 0,
              totalTokens: (totalUsage.input_tokens || 0) + (totalUsage.output_tokens || 0),
            }
            if (onTokenUsage) onTokenUsage(tokenUsage)
          }

          // Done
          onDone()
          return
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        const error = e?.message || String(e)
        onError(error)
      }
    }

    run().catch((e: any) => {
      console.error('[AnthropicProvider] Unhandled error in agentStream run():', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  },

}

