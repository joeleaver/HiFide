import { GoogleGenerativeAI } from '@google/generative-ai'
import { formatSummary } from '../agent/types'

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

// Tiny non-crypto hash for preamble/tool schemas
function hashStr(s: string): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16)
}



// In-memory Gemini chat sessions keyed by sessionId
const geminiChats = new Map<string, any>()

// In-memory Gemini agent contents per session
const geminiAgentContents = new Map<string, any[]>()

export const GeminiProvider: ProviderAdapter = {
  id: 'gemini',
  async chatStream({ apiKey, model, messages, onChunk, onDone, onError, onTokenUsage, sessionId, onConversationMeta }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const m = genAI.getGenerativeModel({ model, systemInstruction }) as any


    // Emit preamble hash for persistence (system only)
    try { onConversationMeta?.({ provider: 'gemini', sessionId, preambleHash: hashStr(systemInstruction || '') }) } catch {}

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
        if (sessionId) {
          let chat = geminiChats.get(sessionId)
          if (!chat) {
            const nonSystem = messages.filter(m => m.role !== 'system')
            // Use all but the last user message as history
            const lastUserIdxFromEnd = [...nonSystem].reverse().findIndex(m => m.role === 'user')
            const lastUserMsg = lastUserIdxFromEnd >= 0 ? nonSystem[nonSystem.length - 1 - lastUserIdxFromEnd] : nonSystem[nonSystem.length - 1]
            const history = nonSystem
              .filter(m => m !== lastUserMsg)
              .map((msg: ChatMessage) => ({ role: msg.role === 'assistant' ? 'model' : msg.role, parts: [{ text: msg.content }] }))
            chat = (m as any).startChat({ history })
            geminiChats.set(sessionId, chat)
          }
          const lastUserText = [...messages].reverse().find(mm => mm.role === 'user')?.content || ''
          const res: any = await withRetries(() => chat.sendMessageStream(lastUserText) as any)
          holder.abort = () => { try { res?.abortController?.abort?.() } catch {} }
          try {
            for await (const chunk of res.stream) {
              try {
                const t = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
                if (t) onChunk(String(t))
              } catch (e: any) { onError(e?.message || String(e)) }
            }
          } catch (e: any) {
            // Stream iteration failed (e.g., parse error)
            onError(e?.message || String(e))
          }
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
          } catch {}
          onDone()
        } else {
          const res: any = await withRetries(() => m.generateContentStream({ contents }) as any)
          holder.abort = () => { try { res?.abortController?.abort?.() } catch {} }
          try {
            for await (const chunk of res.stream) {
              try {
                const t = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
                if (t) onChunk(String(t))
              } catch (e: any) { onError(e?.message || String(e)) }
            }
          } catch (e: any) {
            // Stream iteration failed (e.g., parse error)
            onError(e?.message || String(e))
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
        }
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
    })().catch((e: any) => {
      // Handle any errors that occur after chatStream returns
      // This prevents unhandled promise rejections
      console.error('[GeminiProvider] Unhandled error in chatStream:', e)
      try {
        onError(e?.message || String(e))
      } catch {}
    })

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with Gemini function calling
  async agentStream({ apiKey, model, messages, tools, responseSchema: _responseSchema, toolMeta, onChunk, onDone, onError, onTokenUsage, onToolStart, onToolEnd, onToolError, sessionId }): Promise<StreamHandle> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const m: any = genAI.getGenerativeModel({ model, systemInstruction })

    // Map tools to Gemini function declarations
    const toolMap = new Map<string, { run: (input: any, meta?: any) => any }>()
    const functionDeclarations = tools.map((t) => {
      toolMap.set(t.name, { run: t.run })
      return {
        name: t.name,
        description: t.description,
        parameters: stripAdditionalProperties(t.parameters) as any,
      }
    })

    let contents: any[]
    if (sessionId) {
      const cached = geminiAgentContents.get(sessionId)
      if (cached && cached.length) {
        contents = [...cached]
      } else {
        contents = messages
          .filter(m => m.role !== 'system')
          .map((msg: ChatMessage) => ({ role: msg.role === 'assistant' ? 'model' : msg.role, parts: [{ text: msg.content }] }))
        geminiAgentContents.set(sessionId, [...contents])
      }
    } else {
      contents = messages
        .filter(m => m.role !== 'system')
        .map((msg: ChatMessage) => ({ role: msg.role === 'assistant' ? 'model' : msg.role, parts: [{ text: msg.content }] }))
    }

    // We'll iteratively stream until no functionCalls appear in a streamed turn
    let shouldPrune = false
    let pruneData: any = null

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

          try {
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
          } catch (e: any) {
            // Stream iteration failed (e.g., parse error)
            onError(e?.message || String(e))
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
              // Generate a unique call ID for this tool invocation
              const callId = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

              try {
                const tool = toolMap.get(name)
                const schema = tools.find(t => t.name === name)?.parameters
                const v = validateJson(schema as any, args)
                if (!v.ok) {
                  toolResponses.push({ functionResponse: { name, response: { content: `Validation error: ${v.errors || 'invalid input'}` } } })
                  continue
                }

                // Notify tool start
                try { onToolStart?.({ callId, name, arguments: args }) } catch {}

                const result = await Promise.resolve(tool?.run(args, toolMeta))

                // Notify tool end
                try { onToolEnd?.({ callId, name, result }) } catch {}

                if (result && result._meta && result._meta.trigger_pruning) {
                  shouldPrune = true
                  pruneData = result._meta.summary
                }
                toolResponses.push({ functionResponse: { name, response: { content: typeof result === 'string' ? result : JSON.stringify(result) } } })
              } catch (e: any) {
                // Notify tool error
                try { onToolError?.({ callId, name, error: e?.message || String(e) }) } catch {}
                toolResponses.push({ functionResponse: { name, response: { content: `Error: ${e?.message || String(e)}` } } })
              }
            }
            contents.push({ role: 'user', parts: toolResponses })
            if (shouldPrune && pruneData) {
              const summaryText = formatSummary(pruneData)
              const recent = contents.slice(-5)
              contents.length = 0
              contents.push({ role: 'user', parts: [{ text: summaryText }] }, ...recent)
              shouldPrune = false
              pruneData = null
            }
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

    run().catch((e: any) => {
      // Handle any errors that occur after agentStream returns
      // This prevents unhandled promise rejections
      console.error('[GeminiProvider] Unhandled error in agentStream run():', e)
      try {
        onError(e?.message || String(e))
      } catch {}
    })
    // Persist session contents for continuity
    if (sessionId) {
      try { geminiAgentContents.set(sessionId, [...contents]) } catch {}
    }
    return { cancel: () => { cancelled = true } }
  },

}

