import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProviderAdapter, StreamHandle, ChatMessage } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'

// Gemini doesn't support additionalProperties or const in schemas, so strip them out recursively
function stripAdditionalProperties(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const cleaned = { ...schema }
  delete cleaned.additionalProperties

  // Gemini doesn't support "const" - convert to enum with single value
  if ('const' in cleaned) {
    cleaned.enum = [cleaned.const]
    delete cleaned.const
  }

  // Recursively clean nested schemas
  if (cleaned.properties) {
    cleaned.properties = Object.fromEntries(
      Object.entries(cleaned.properties).map(([k, v]) => [k, stripAdditionalProperties(v)])
    )
  }
  if (cleaned.items) {
    cleaned.items = stripAdditionalProperties(cleaned.items)
  }
  if (cleaned.oneOf) {
    cleaned.oneOf = cleaned.oneOf.map(stripAdditionalProperties)
  }
  if (cleaned.anyOf) {
    cleaned.anyOf = cleaned.anyOf.map(stripAdditionalProperties)
  }
  if (cleaned.allOf) {
    cleaned.allOf = cleaned.allOf.map(stripAdditionalProperties)
  }

  return cleaned
}

export const GeminiProvider: ProviderAdapter = {
  id: 'gemini',
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const m = genAI.getGenerativeModel({ model, systemInstruction }) as any

    // Convert messages to Google content format (exclude system)
    const contents = messages
      .filter(m => m.role !== 'system')
      .map((msg: ChatMessage) => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }],
      }))

    const holder: { abort?: () => void } = {}

    ;(async () => {
      try {
        const res: any = await withRetries(() => m.generateContentStream({ contents }) as any)
        holder.abort = () => { try { res?.abortController?.abort?.() } catch {} }
        for await (const chunk of res.stream) {
          try {
            const t = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
            if (t) onChunk(String(t))
          } catch (e: any) { onError(e?.message || String(e)) }
        }

        // Extract token usage from response
        try {
          const response = await res.response
          const usage = response?.usageMetadata
          if (usage && onTokenUsage) {
            onTokenUsage({
              inputTokens: usage.promptTokenCount || 0,
              outputTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
            })
          }
        } catch (e) {
          // Token usage extraction failed, continue anyway
        }

        onDone()
      } catch (e: any) {
        // Fallback: if streaming is not supported for this model/API version, try non-stream generateContent
        if (e?.name === 'AbortError') return
        try {
          const res: any = await withRetries(() => (m as any).generateContent({ contents }) as any)
          const text = res?.response?.text?.() ?? res?.text?.() ?? res?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
          if (text) onChunk(String(text))

          // Extract token usage from non-streaming response
          try {
            const usage = res?.response?.usageMetadata
            if (usage && onTokenUsage) {
              onTokenUsage({
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0,
              })
            }
          } catch (e) {
            // Token usage extraction failed, continue anyway
          }

          onDone()
        } catch (e2: any) {
          onError(e2?.message || String(e2))
        }
      }
    })()

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with Gemini function calling
  async agentStream({ apiKey, model, messages, tools, responseSchema: _responseSchema, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const m: any = genAI.getGenerativeModel({ model, systemInstruction })

    // Map tools to Gemini function declarations
    const toolMap = new Map<string, { run: (input: any) => any }>()
    const functionDeclarations = tools.map((t) => {
      toolMap.set(t.name, { run: t.run })
      return {
        name: t.name,
        description: t.description,
        parameters: stripAdditionalProperties(t.parameters) as any,
      }
    })

    const contents: any[] = messages
      .filter(m => m.role !== 'system')
      .map((msg: ChatMessage) => ({ role: msg.role === 'assistant' ? 'model' : msg.role, parts: [{ text: msg.content }] }))

    // We'll iteratively stream until no functionCalls appear in a streamed turn
    let cancelled = false
    let totalUsage: any = null

    const run = async () => {
      try {
        while (!cancelled) {
          const genOpts: any = {}
          if (_responseSchema) {
            genOpts.responseMimeType = 'application/json'
            genOpts.responseSchema = (_responseSchema as any).schema || _responseSchema
          }

          // Stream a model turn and capture any functionCalls while streaming
          const streamRes: any = await withRetries(() => m.generateContentStream({
            contents,
            tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
            ...(genOpts as any),
          }) as any)

          // Accumulate function calls incrementally
          const callAcc: Record<string, { name: string; args: any }> = {}

          for await (const chunk of streamRes.stream) {
            try {
              // Stream text parts
              const t = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
              if (t) onChunk(String(t))

              // Capture functionCall parts if present
              const parts = chunk?.candidates?.[0]?.content?.parts || []
              for (const p of parts) {
                if (p?.functionCall) {
                  const name = p.functionCall.name
                  const args = p.functionCall.args
                  const key = name // one per name per turn typical
                  callAcc[key] = { name, args }
                }
              }
            } catch (e: any) { onError(e?.message || String(e)) }
          }

          // Extract and accumulate token usage
          try {
            const response = await streamRes.response
            const usage = response?.usageMetadata
            if (usage) {
              if (!totalUsage) {
                totalUsage = usage
              } else {
                totalUsage.promptTokenCount = (totalUsage.promptTokenCount || 0) + (usage.promptTokenCount || 0)
                totalUsage.candidatesTokenCount = (totalUsage.candidatesTokenCount || 0) + (usage.candidatesTokenCount || 0)
                totalUsage.totalTokenCount = (totalUsage.totalTokenCount || 0) + (usage.totalTokenCount || 0)
              }
            }
          } catch (e) {
            // Token usage extraction failed, continue anyway
          }

          const functionCalls = Object.values(callAcc)
          if (functionCalls.length > 0) {
            // Execute functions, push functionResponse parts, then continue
            const modelParts = functionCalls.map(fc => ({ functionCall: { name: fc.name, args: fc.args || {} } }))
            contents.push({ role: 'model', parts: modelParts })

            const toolResponses: any[] = []
            for (const fc of functionCalls) {
              const name = fc.name
              const args = fc.args || {}
              try {
                const tool = toolMap.get(name)
                const schema = tools.find(t => t.name === name)?.parameters
                const v = validateJson(schema as any, args)
                if (!v.ok) {
                  toolResponses.push({ functionResponse: { name, response: { content: `Validation error: ${v.errors || 'invalid input'}` } } })
                  continue
                }
                const result = await Promise.resolve(tool?.run(args))
                toolResponses.push({ functionResponse: { name, response: { content: typeof result === 'string' ? result : JSON.stringify(result) } } })
              } catch (e: any) {
                toolResponses.push({ functionResponse: { name, response: { content: `Error: ${e?.message || String(e)}` } } })
              }
            }
            contents.push({ role: 'user', parts: toolResponses })
            continue
          }

          // No function calls in this streamed turn -> we've streamed the final answer
          // Report accumulated token usage
          if (totalUsage && onTokenUsage) {
            onTokenUsage({
              inputTokens: totalUsage.promptTokenCount || 0,
              outputTokens: totalUsage.candidatesTokenCount || 0,
              totalTokens: totalUsage.totalTokenCount || 0,
            })
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

