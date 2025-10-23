import { GoogleGenAI } from '@google/genai'
import { formatSummary } from '../agent/types'

import type { ProviderAdapter, StreamHandle } from './provider'
import { validateJson } from './jsonschema'
import { withRetries } from './retry'

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

// Gemini doesn't support additionalProperties, const, default, or complex oneOf/anyOf/allOf in schemas
// Strip them out recursively and simplify the schema
function stripAdditionalProperties(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const cleaned = { ...schema }
  delete cleaned.additionalProperties

  // Gemini Flash doesn't support "default" values in schemas
  delete cleaned.default

  // Gemini doesn't support "const" - convert to enum with single value
  if ('const' in cleaned) {
    cleaned.enum = [cleaned.const]
    delete cleaned.const
  }

  // Remove oneOf/anyOf/allOf - these cause INTERNAL errors in Gemini Flash
  // If present, just use the first option (tools should be pre-flattened anyway)
  if (cleaned.oneOf) {
    delete cleaned.oneOf
  }
  if (cleaned.anyOf) {
    delete cleaned.anyOf
  }
  if (cleaned.allOf) {
    delete cleaned.allOf
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

  return cleaned
}

// Note: We no longer maintain session state for chat instances.
// The scheduler manages all conversation history and passes full message arrays.
// This makes providers stateless and simplifies context management.

export const GeminiProvider: ProviderAdapter = {
  id: 'gemini',
  async chatStream({ apiKey, model, systemInstruction, contents, emit: _emit, onChunk, onDone, onError, onTokenUsage }): Promise<StreamHandle> {

    const ai = new GoogleGenAI({ apiKey })

    // Messages are already formatted by llm-service
    // systemInstruction: string
    // contents: Array<{role: string, parts: Array<{text: string}>}>


    const holder: { abort?: () => void } = {}

    ;(async () => {
      try {
        // Stateless: always use generateContentStream with full message history
        const res: any = await withRetries(() => ai.models.generateContentStream({
          model,
          contents: contents || [],
          config: {
            systemInstruction: systemInstruction || undefined,
          },
        }) as any)
        holder.abort = () => { try { res?.controller?.abort?.() } catch {} }

        try {
          for await (const chunk of res) {
            try {
              const t = chunk?.text
              if (t) {
                const text = String(t)
                onChunk(text)
              }
            } catch (e: any) {
              const error = e?.message || String(e)
              onError(error)
            }
          }
        } catch (e: any) {
          // Stream iteration failed (e.g., parse error)
          const error = e?.message || String(e)
          onError(error)
        }

        // Extract token usage from response
        try {
          const usage = res?.usageMetadata
          if (usage) {
            const cachedTokens = usage.cachedContentTokenCount || 0
            const tokenUsage = {
              inputTokens: usage.promptTokenCount || 0,
              outputTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
              cachedTokens,
            }

            if (onTokenUsage) onTokenUsage(tokenUsage)

            // Log cache hits
            if (cachedTokens > 0) {
            }
          }
        } catch (e) {
          // Token usage extraction failed, continue anyway
        }

        // Done
        onDone()
      } catch (e: any) {
        // Fallback: if streaming is not supported for this model/API version, try non-stream generateContent
        if (e?.name === 'AbortError') return
        try {
          const res: any = await withRetries(() => ai.models.generateContent({
            model,
            contents: contents || [],
            config: {
              systemInstruction: systemInstruction || undefined,
            },
          }) as any)
          const text = res?.text
          if (text) {
            const textStr = String(text)
            onChunk(textStr)
          }

          // Extract token usage from non-streaming response
          try {
          // Update rate limit tracker from headers if available (non-stream fallback)
          try {
            const hdrs = (res as any)?.response?.headers || (res as any)?.raw?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('gemini', model as any, toHeaderMap(hdrs))
            }
          } catch {}

            const usage = res?.usageMetadata
            if (usage) {
              const cachedTokens = usage.cachedContentTokenCount || 0

              const tokenUsage = {
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0,
                cachedTokens,
              }

              if (onTokenUsage) onTokenUsage(tokenUsage)

              // Log cache hits
              if (cachedTokens > 0) {
              }
            }
          } catch (e) {
            // Token usage extraction failed, continue anyway
          }

          // Done
          onDone()
        } catch (e2: any) {
          const error = e2?.message || String(e2)
          onError(error)
        }
      }
    })().catch((e: any) => {
      console.error('[GeminiProvider] Unhandled error in chatStream:', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return {
      cancel: () => { try { holder.abort?.() } catch {} },
    }
  },

  // Agent streaming with Gemini function calling
  async agentStream({ apiKey, model, systemInstruction, contents, tools, responseSchema: _responseSchema, toolMeta, emit: _emit, onChunk, onDone, onError, onTokenUsage, onToolStart, onToolEnd, onToolError }): Promise<StreamHandle> {
    const ai = new GoogleGenAI({ apiKey })

    const holder: { abort?: () => void } = {}

    // Messages are already formatted by llm-service
    // systemInstruction: string
    // contents: Array<{role: string, parts: Array<{text: string}>}>

    // Map tools to Gemini function declarations using new SDK format
    const toolMap = new Map<string, { run: (input: any, meta?: any) => any }>()
    const functionDeclarations = tools.map((t) => {
      toolMap.set(t.name, { run: t.run })
      return {
        name: t.name,
        description: t.description,
        // New SDK uses parametersJsonSchema instead of parameters
        parametersJsonSchema: stripAdditionalProperties(t.parameters) as any,
      }
    })

    // Contents are already formatted - make a mutable copy for the agent loop
    let contentsArray = [...(contents as any[])]

    // We'll iteratively stream until no functionCalls appear in a streamed turn
    let shouldPrune = false

    let pruneData: any = null

    let cancelled = false
    let totalUsage: any = null

    const run = async () => {
      try {
        while (!cancelled) {
          const config: any = {
            systemInstruction: systemInstruction || undefined,
          }
          if (_responseSchema) {
            config.responseMimeType = 'application/json'
            config.responseSchema = (_responseSchema as any).schema || _responseSchema
          }
          if (functionDeclarations.length) {
            config.tools = [{ functionDeclarations }]
          }

          // Stream a model turn and capture any functionCalls while streaming using new SDK
          const streamRes: any = await withRetries(() => ai.models.generateContentStream({
            model,
            contents: contentsArray,
            config,
          }) as any)
          holder.abort = () => { try { streamRes?.controller?.abort?.() } catch {} }

          // Accumulate function calls incrementally
          const callAcc: Record<string, { name: string; args: any }> = {}

          try {
            for await (const chunk of streamRes) {
              try {
                // Stream text parts using new SDK format
                const t = chunk?.text
                if (t) {
                  const text = String(t)
                  onChunk(text)
                }

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
              } catch (e: any) {
                const error = e?.message || String(e)
                onError(error)
              }
            }
          } catch (e: any) {
            // Stream iteration failed (e.g., parse error)
            const error = e?.message || String(e)
            onError(error)
          }

          // Extract and accumulate token usage
          try {
            const usage = streamRes?.usageMetadata
            if (usage) {
              if (!totalUsage) {
                totalUsage = usage
              } else {
                totalUsage.promptTokenCount = (totalUsage.promptTokenCount || 0) + (usage.promptTokenCount || 0)
                totalUsage.candidatesTokenCount = (totalUsage.candidatesTokenCount || 0) + (usage.candidatesTokenCount || 0)
                totalUsage.totalTokenCount = (totalUsage.totalTokenCount || 0) + (usage.totalTokenCount || 0)
                // Accumulate cached tokens as well
                totalUsage.cachedContentTokenCount = (totalUsage.cachedContentTokenCount || 0) + (usage.cachedContentTokenCount || 0)
              }
            }
          } catch (e) {
            // Token usage extraction failed, continue anyway
          }

          const functionCalls = Object.values(callAcc)
          if (functionCalls.length > 0) {
            // Execute functions, push functionResponse parts, then continue
            const modelParts = functionCalls.map(fc => ({ functionCall: { name: fc.name, args: fc.args || {} } }))
            contentsArray.push({ role: 'model', parts: modelParts })

            const toolResponses: any[] = []
          // Update rate limit tracker from headers if available for this streamed turn
          try {
            const hdrs = (streamRes as any)?.response?.headers || (streamRes as any)?.raw?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('gemini', model as any, toHeaderMap(hdrs))
            }
          } catch {}

            for (const fc of functionCalls) {
              const name = fc.name
              const args = fc.args || {}
              // Generate a unique call ID for this tool invocation
              const callId = `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`

              try {
                const tool = toolMap.get(name)
                const schema = tools.find(t => t.name === name)?.parameters
                const v = validateJson(schema as any, args)
                if (!v.ok) {
                  toolResponses.push({ functionResponse: { name, response: { content: `Validation error: ${v.errors || 'invalid input'}` } } })
                  continue
                }

                // Generate tool execution ID


                // Notify tool start
                try { onToolStart?.({ callId, name, arguments: args }) } catch {}

                const result = await Promise.resolve(tool?.run(args, toolMeta))

                // Notify tool end (full result to UI)
                try { onToolEnd?.({ callId, name, result }) } catch {}

                if (result && result._meta && result._meta.trigger_pruning) {
                  shouldPrune = true
                  pruneData = result._meta.summary
                }
                // Minify heavy tool results before adding to conversation
                const { minifyToolResult } = await import('./toolResultMinify')
                const compact = minifyToolResult(name, result)
                toolResponses.push({ functionResponse: { name, response: { content: typeof compact === 'string' ? compact : JSON.stringify(compact) } } })
              } catch (e: any) {
                // Notify tool error
                try { onToolError?.({ callId, name, error: e?.message || String(e) }) } catch {}
                toolResponses.push({ functionResponse: { name, response: { content: `Error: ${e?.message || String(e)}` } } })
              }
            }
            contentsArray.push({ role: 'user', parts: toolResponses })
            if (shouldPrune && pruneData) {
              const summaryText = formatSummary(pruneData)
              const recent = contentsArray.slice(-5)
              contentsArray.length = 0
              contentsArray.push({ role: 'user', parts: [{ text: summaryText }] }, ...recent)
              shouldPrune = false
              pruneData = null
            }
            continue
          }

          // No function calls in this streamed turn -> we've streamed the final answer
          // Report accumulated token usage
          if (totalUsage && onTokenUsage) {
            const cachedTokens = totalUsage.cachedContentTokenCount || 0

            onTokenUsage({
              inputTokens: totalUsage.promptTokenCount || 0,
              outputTokens: totalUsage.candidatesTokenCount || 0,
              totalTokens: totalUsage.totalTokenCount || 0,
              cachedTokens,
            })

            // Log cache hits
            if (cachedTokens > 0) {
            }
          // Update rate limit tracker from headers if available for final streamed answer
          try {
            const hdrs = (streamRes as any)?.response?.headers || (streamRes as any)?.raw?.response?.headers
            if (hdrs) {
              rateLimitTracker.updateFromHeaders('gemini', model as any, toHeaderMap(hdrs))
            }
          } catch {}

          }

          // Done
          onDone()
          return
        }
      } catch (e: any) {
        const error = e?.message || String(e)
        onError(error)
      }
    }

    run().catch((e: any) => {
      console.error('[GeminiProvider] Unhandled error in agentStream run():', e)
      try {
        const error = e?.message || String(e)
        onError(error)
      } catch {}
    })

    return { cancel: () => { cancelled = true; try { holder.abort?.() } catch {} } }
  },

}

