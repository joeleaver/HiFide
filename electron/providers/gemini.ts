import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProviderAdapter, StreamHandle, ChatMessage } from './provider'

export const GeminiProvider: ProviderAdapter = {
  id: 'gemini',
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const m = genAI.getGenerativeModel({ model }) as any

    // Convert messages to Google content format
    const contents = messages.map((msg: ChatMessage) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    }))

    const holder: { abort?: () => void } = {}

    ;(async () => {
      try {
        const res = await m.generateContentStream({ contents })
        holder.abort = () => { try { res?.abortController?.abort?.() } catch {} }
        for await (const chunk of res.stream) {
          try {
            const t = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
            if (t) onChunk(String(t))
          } catch (e: any) { onError(e?.message || String(e)) }
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

  // Agent streaming with Gemini function calling
  async agentStream({ apiKey, model, messages, tools, responseSchema: _responseSchema, onChunk, onDone, onError }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const m: any = genAI.getGenerativeModel({ model })

    // Map tools to Gemini function declarations
    const toolMap = new Map<string, { run: (input: any) => any }>()
    const functionDeclarations = tools.map((t) => {
      toolMap.set(t.name, { run: t.run })
      return {
        name: t.name,
        description: t.description,
        parameters: t.parameters as any,
      }
    })

    const contents: any[] = messages.map((msg: ChatMessage) => ({ role: msg.role, parts: [{ text: msg.content }] }))

    // We'll iteratively call until no functionCalls
    let cancelled = false
    const run = async () => {
      try {
        while (!cancelled) {
          const res: any = await m.generateContent({
            contents,
            tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
          })

          const cand = res?.response || res
          const parts = cand?.candidates?.[0]?.content?.parts || cand?.candidates?.[0]?.content?.parts || res?.candidates?.[0]?.content?.parts
          const functionCalls: any[] = (parts || []).filter((p: any) => p?.functionCall)

          if (functionCalls.length > 0) {
            // Execute functions, push functionResponse parts, then continue
            const toolResponses = [] as any[]
            for (const fc of functionCalls) {
              const name = fc.functionCall.name
              const args = fc.functionCall.args || {}
              try {
                const tool = toolMap.get(name)
                const result = await Promise.resolve(tool?.run(args))
                toolResponses.push({ functionResponse: { name, response: { content: typeof result === 'string' ? result : JSON.stringify(result) } } })
              } catch (e: any) {
                toolResponses.push({ functionResponse: { name, response: { content: `Error: ${e?.message || String(e)}` } } })
              }
            }
            contents.push({ role: 'model', parts })
            contents.push({ role: 'user', parts: toolResponses })
            continue
          }

          // No function calls, stream final text (best-effort chunking)
          const text = cand?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
          if (text) {
            const CHUNK = 80
            for (let i = 0; i < text.length && !cancelled; i += CHUNK) {
              onChunk(text.slice(i, i + CHUNK))
              await new Promise((r) => setTimeout(r, 1))
            }
          }
          onDone()
          return
        }
      } catch (e: any) {
        onError(e?.message || String(e))
      }
    }

    run()
    return { cancel: () => { cancelled = true } }
  },

}

