import OpenAI from 'openai'
import type { ProviderAdapter, StreamHandle, ChatMessage, AgentTool } from './provider'

export const OpenAIProvider: ProviderAdapter = {
  id: 'openai',

  // Plain chat streaming (no tool-calling)
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    const holder: { stream?: any } = {}

    ;(async () => {
      try {
        const stream: any = await client.chat.completions.create({
          model,
          stream: true,
          messages: messages.map((m: ChatMessage) => ({ role: m.role as any, content: m.content })),
        })
        holder.stream = stream

        for await (const part of stream) {
          try {
            const delta = part?.choices?.[0]?.delta?.content
            if (delta) onChunk(delta)
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
      cancel: () => {
        try {
          holder.stream?.controller?.abort?.()
          holder.stream?.close?.()
        } catch {
          /* noop */
        }
      },
    }
  },

  // Agent streaming with tool-calling via Chat Completions tools
  async agentStream({ apiKey, model, messages, tools, responseSchema, onChunk, onDone, onError }): Promise<StreamHandle> {
    const client = new OpenAI({ apiKey })

    // Map internal tools to OpenAI Chat Completions tools format (sanitize names)
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
    const oaTools: any[] = tools.map((t) => {
      const safeName = toSafeName(t.name)
      toolMap.set(safeName, t)
      return {
        type: 'function',
        function: {
          name: safeName,
          description: t.description || undefined,
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      }
    })

    // Conversation loop with tool calls; final answer is streamed in chunks
    const conv: Array<{ role: string; content?: string; name?: string; tool_call_id?: string; tool_calls?: any[] }> =
      messages.map((m) => ({ role: m.role, content: m.content }))

    let cancelled = false
    const controller = new AbortController()

    const run = async () => {
      try {
        while (!cancelled) {
          let useResponseFormat = !!responseSchema
          // Use non-streaming for tool loops; stream only the final assistant message
          let completion: any
          try {
            completion = await client.chat.completions.create({
              model,
              messages: conv as any,
              tools: oaTools.length ? oaTools : undefined,
              tool_choice: oaTools.length ? 'auto' : undefined,
              // If provided, request structured output (best-effort; supported on newer models)
              response_format: useResponseFormat ? { type: 'json_schema', json_schema: responseSchema } as any : undefined,
            })
          } catch (err: any) {
            // Some models don’t support response_format or strict JSON schema; retry once without it
            const msg = err?.message || ''
            if (useResponseFormat && (err?.status === 400 || /response_format|json_schema|unsupported/i.test(msg))) {
              useResponseFormat = false
              completion = await client.chat.completions.create({
                model,
                messages: conv as any,
                tools: oaTools.length ? oaTools : undefined,
                tool_choice: oaTools.length ? 'auto' : undefined,
              })
            } else {
              throw err
            }
          }

          const choice = completion?.choices?.[0]
          const msg = choice?.message
          const toolCalls = msg?.tool_calls || []

          // If the model requested tools, execute them and continue
          if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            // Append assistant tool_calls message to history
            conv.push({ role: 'assistant', content: msg?.content || null, tool_calls: toolCalls })

            for (const tc of toolCalls) {
              try {
                const name = tc?.function?.name as string
                const argsStr = tc?.function?.arguments || '{}'
                const tool = toolMap.get(name)
                if (!tool) {
                  conv.push({ role: 'tool', tool_call_id: tc?.id, content: `Tool ${name} not found` })
                  continue
                }
                let input: any = {}
                try { input = JSON.parse(argsStr) } catch {}
                const result = await Promise.resolve(tool.run(input))
                const content = typeof result === 'string' ? result : JSON.stringify(result)
                conv.push({ role: 'tool', tool_call_id: tc?.id, content, name })
              } catch (e: any) {
                conv.push({ role: 'tool', tool_call_id: tc?.id, content: `Error: ${e?.message || String(e)}` })
              }
            }
            // Continue loop to let the model observe tool results
            continue
          }

          // No tool calls: we have final assistant content. Stream it to caller.
          const finalText: string = msg?.content || ''
          if (finalText) {
            // Stream in small chunks to mimic streaming UX
            const CHUNK = 80
            for (let i = 0; i < finalText.length && !cancelled; i += CHUNK) {
              onChunk(finalText.slice(i, i + CHUNK))
              // micro-yield
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

    return {
      cancel: () => {
        cancelled = true
        try { (controller as any).abort?.() } catch {}
      },
    }
  }
}
