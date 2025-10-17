import Anthropic from '@anthropic-ai/sdk'
import type { ProviderAdapter, StreamHandle, AgentTool } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'
import { formatSummary } from '../agent/types'

// Note: Anthropic has always been stateless - it requires full message history every time.
// This is now consistent with our architecture where the scheduler manages all conversation state.

export const AnthropicProvider: ProviderAdapter = {
  id: 'anthropic',

  async chatStream({ apiKey, model, system, messages, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
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
          max_tokens: 2048
        }) as any)
        holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }

        let usage: any = null

        for await (const evt of stream) {
          try {
            if (evt?.type === 'content_block_delta') {
              const t = evt?.delta?.text
              if (t) onChunk(String(t))
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
            onError(e?.message || String(e))
          }
        }

        // Report token usage if available
        if (usage && onTokenUsage) {
          onTokenUsage({
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          })
        }

        onDone()
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        onError(e?.message || String(e))
      }
    })().catch((e: any) => {
      // Handle any errors that occur after chatStream returns
      // This prevents unhandled promise rejections
      console.error('[AnthropicProvider] Unhandled error in chatStream:', e)
      try {
        onError(e?.message || String(e))
      } catch {}
    })

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with tool-calling using Anthropic Messages API
  async agentStream({ apiKey, model, system, messages, tools, responseSchema: _responseSchema, onChunk, onDone, onError, onTokenUsage, toolMeta, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' } as any })

    // Map tools to Anthropic format
    const toolMap = new Map<string, AgentTool>()
    const anthTools = tools.map((t) => {
      toolMap.set(t.name, t)
      return { name: t.name, description: t.description || undefined, input_schema: t.parameters as any }
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
          // Stream an assistant turn and capture any tool_use blocks while streaming
          const stream: any = await withRetries(() => client.messages.create({
            model: model as any,
            system: (systemAllBlocks && systemAllBlocks.length) ? (systemAllBlocks as any) : undefined,
            messages: conv as any,
            tools: anthTools.length ? anthTools : undefined,
            stream: true,
            max_tokens: 2048,
          }) as any)

          // Accumulate tool_use inputs incrementally and track usage
          const active: Record<string, { id: string; name: string; inputText: string }> = {}
          const completed: Array<{ id: string; name: string; input: any }> = []
          let usage: any = null

          for await (const evt of stream) {
            try {
              if (evt?.type === 'content_block_delta') {
                const t = evt?.delta?.text
                if (t) onChunk(String(t))
              } else if (evt?.type === 'content_block_start' && evt?.content_block?.type === 'tool_use') {
                const id = evt?.content_block?.id
                const name = evt?.content_block?.name
                if (id && name) active[id] = { id, name, inputText: '' }
              } else if (evt?.type === 'input_json_delta' && evt?.delta) {
                // Append partial JSON chunks for the active tool_use (Anthropic streams JSON deltas)
                const id = evt?.content_block_id || evt?.block_id
                const chunk = typeof evt.delta === 'string' ? evt.delta : JSON.stringify(evt.delta)
                if (id && active[id]) active[id].inputText += chunk
              } else if (evt?.type === 'content_block_stop') {
                const id = evt?.content_block_id || evt?.block_id
                const item = id ? active[id] : undefined
                if (item) {
                  let parsed: any = {}
                  try { parsed = item.inputText ? JSON.parse(item.inputText) : {} } catch {}
                  completed.push({ id: item.id, name: item.name, input: parsed })
                  delete active[id!]
                }
              } else if (evt?.type === 'message_start') {
                // Capture usage from message_start event
                usage = evt?.message?.usage
              } else if (evt?.type === 'message_delta') {
                // Update usage from message_delta event
                if (evt?.usage) usage = evt.usage
              }
            } catch (e: any) { onError(e?.message || String(e)) }
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
            // Reconstruct assistant content with tool_use blocks for the transcript context
            const assistantBlocks = completed.map(tu => ({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input }))
            conv.push({ role: 'assistant', content: assistantBlocks as any })

            // Execute tools and add tool_result blocks
            const results: any[] = []
            let shouldPrune = false
            let pruneSummary: any = null

            for (const tu of completed) {
              try {
                const tool = toolMap.get(tu.name)
                if (!tool) {
                  results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: Tool ${tu.name} not found`, is_error: true })
                  continue
                }
                const schema = (tool as any)?.parameters
                const v = validateJson(schema, tu.input)
                if (!v.ok) {
                  results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Validation error: ${v.errors || 'invalid input'}`, is_error: true })
                  continue
                }

                // Notify tool start
                try { onToolStart?.({ callId: tu.id, name: tu.name, arguments: tu.input }) } catch {}

                // Pass toolMeta to tool.run()
                const result = await Promise.resolve(tool.run(tu.input, toolMeta))

                // Notify tool end
                try { onToolEnd?.({ callId: tu.id, name: tu.name, result }) } catch {}

                // Check if tool requested pruning
                if (result?._meta?.trigger_pruning) {
                  shouldPrune = true
                  pruneSummary = result._meta.summary
                }

                results.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof result === 'string' ? result : JSON.stringify(result) })
              } catch (e: any) {
                // Notify tool error
                try { onToolError?.({ callId: tu.id, name: tu.name, error: e?.message || String(e) }) } catch {}
                results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e?.message || String(e)}`, is_error: true })
              }
            }
            conv.push({ role: 'user', content: results })

            // Prune conversation if requested
            if (shouldPrune && pruneSummary) {
              pruneConversation(pruneSummary)
            }

            continue
          }

          // No tool_use in this streamed turn; we already streamed the final text
          // Report accumulated token usage
          if (totalUsage && onTokenUsage) {
            onTokenUsage({
              inputTokens: totalUsage.input_tokens || 0,
              outputTokens: totalUsage.output_tokens || 0,
              totalTokens: (totalUsage.input_tokens || 0) + (totalUsage.output_tokens || 0),
            })
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
      console.error('[AnthropicProvider] Unhandled error in agentStream run():', e)
      try {
        onError(e?.message || String(e))
      } catch {}
    })

    return { cancel: () => { cancelled = true } }
  },

}

