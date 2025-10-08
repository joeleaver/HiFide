import Anthropic from '@anthropic-ai/sdk'
import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from './provider'

export const AnthropicProvider: ProviderAdapter = {
  id: 'anthropic',

  async chatStream({ apiKey, model, messages, onChunk, onDone, onError }): Promise<StreamHandle> {
    const client = new Anthropic({ apiKey })

    const conv = messages.map((m: ChatMessage) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }))

    const holder: { abort?: () => void } = {}

    ;(async () => {
      try {
        const stream = await client.messages.create({ model, messages: conv as any, stream: true, max_tokens: 2048 }) as any
        holder.abort = () => { try { stream?.controller?.abort?.() } catch {} }
        for await (const evt of stream) {
          try {
            if (evt?.type === 'content_block_delta') {
              const t = evt?.delta?.text
              if (t) onChunk(String(t))
            } else if (evt?.type === 'message_stop') {
              // end of stream
            }
          } catch (e: any) {
            onError(e?.message || String(e))
          }
        }
        onDone()
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        onError(e?.message || String(e))
      }
    })()

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with tool-calling using Anthropic Messages API
  async agentStream({ apiKey, model, messages, tools, responseSchema: _responseSchema, onChunk, onDone, onError }): Promise<StreamHandle> {
    const client = new Anthropic({ apiKey })

    // Map tools to Anthropic format
    const toolMap = new Map<string, AgentTool>()
    const anthTools = tools.map((t) => {
      toolMap.set(t.name, t)
      return { name: t.name, description: t.description || undefined, input_schema: t.parameters as any }
    }) as any

    const conv: any[] = messages.map((m) => ({ role: m.role, content: m.content }))
    let cancelled = false

    const run = async () => {
      try {
        while (!cancelled) {
          const resp: any = await client.messages.create({
            model: model as any,
            messages: conv as any,
            tools: anthTools.length ? anthTools : undefined,
            max_tokens: 2048,
            // No strict structured output here; Anthropic recommends using tools for structure
          })

          // Collect tool calls from content blocks
          const toolUses: Array<{ id: string; name: string; input: any }> = []
          for (const block of resp?.content || []) {
            if (block?.type === 'tool_use') {
              toolUses.push({ id: block.id, name: block.name, input: block.input })
            }
          }

          if (toolUses.length > 0) {
            // Append assistant message including tool_use
            conv.push({ role: 'assistant', content: resp.content })
            // Execute tools and add a single user message with tool_result blocks
            const results: any[] = []
            for (const tu of toolUses) {
              try {
                const tool = toolMap.get(tu.name)
                if (!tool) {
                  results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: Tool ${tu.name} not found`, is_error: true })
                  continue
                }
                const result = await Promise.resolve(tool.run(tu.input))
                results.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof result === 'string' ? result : JSON.stringify(result) })
              } catch (e: any) {
                results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e?.message || String(e)}`, is_error: true })
              }
            }
            conv.push({ role: 'user', content: results })
            continue
          }

          // No tool use: stream final text
          const finalText = (resp?.content || [])
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.text || ''))
            .join('')
          if (finalText) {
            const CHUNK = 80
            for (let i = 0; i < finalText.length && !cancelled; i += CHUNK) {
              onChunk(finalText.slice(i, i + CHUNK))
              await new Promise((r) => setTimeout(r, 1))
            }
          }
          onDone()
          return
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        onError(e?.message || String(e))
      }
    }

    run()

    return { cancel: () => { cancelled = true } }
  },

}

