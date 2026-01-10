/**
 * Native Gemini Provider
 *
 * Uses the official Google GenAI SDK directly instead of the OpenAI-compatible endpoint.
 * This gives us full access to Gemini-specific features:
 * - Explicit context caching (guaranteed 75-90% cost savings)
 * - Native thinking mode configuration
 * - Proper cached token reporting
 * - Better error messages
 *
 * Reference: https://ai.google.dev/gemini-api/docs
 */
import { GoogleGenAI } from '@google/genai'
import type { Content, Part, FunctionDeclaration, Tool as GeminiTool } from '@google/genai'
import type { ProviderAdapter, AgentTool, StreamHandle, ChatMessage } from '../providers/provider'
import { supportsExtendedThinking } from '../../shared/model-capabilities'

// Cache management
import {
  createGeminiCache,
  geminiCacheStore,
  isCacheExpired,
  computeMessageHash,
  type GeminiCacheRef
} from './gemini-cache-manager'

import fs from 'node:fs'

// Constants
const CACHE_TTL_SECONDS = 3600 // 1 hour
const MIN_CACHE_TOKENS = 2048
const MAX_AGENTIC_STEPS = 25
const DEBUG_FILE = '/tmp/hifide-gemini-debug.json'
const DEBUG_THINKING = true // Temporarily enabled to diagnose thinking display

// Mid-loop cache refresh: refresh cache when fresh content exceeds this threshold
// Keep this low because thoughtSignatures add 400-500 tokens per function call
const CACHE_REFRESH_THRESHOLD_TOKENS = 500

// Debug logging to file
function debugLog(entry: any) {
  if (process.env.HF_DEBUG_GEMINI !== '1') return
  try {
    let data: any[] = []
    if (fs.existsSync(DEBUG_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(DEBUG_FILE, 'utf8'))
      } catch {}
    }
    data.push({ timestamp: new Date().toISOString(), ...entry })
    // Keep last 100 entries
    if (data.length > 100) data = data.slice(-100)
    fs.writeFileSync(DEBUG_FILE, JSON.stringify(data, null, 2))
  } catch {}
}

/**
 * Convert our ChatMessage format to Gemini's Content format
 */
function toGeminiContents(messages: ChatMessage[]): Content[] {
  return messages
    .filter(m => m.role !== 'system') // System is handled separately
    .map(msg => {
      const role = msg.role === 'assistant' ? 'model' : 'user'

      if (typeof msg.content === 'string') {
        return { role, parts: [{ text: msg.content }] }
      }

      // Multi-part content (text + images)
      const parts: Part[] = msg.content.map(part => {
        if (part.type === 'text') {
          return { text: part.text }
        } else {
          return {
            inlineData: {
              mimeType: part.mimeType,
              data: part.image
            }
          }
        }
      })

      return { role, parts }
    })
}

/**
 * Convert our AgentTool format to Gemini's Tool format
 */
function toGeminiTools(tools: AgentTool[]): GeminiTool[] {
  if (!tools?.length) return []

  const functionDeclarations: FunctionDeclaration[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    parameters: tool.parameters || { type: 'object', properties: {} }
  }))

  return [{ functionDeclarations }]
}

/**
 * Estimate token count from text (rough estimate)
 */
function estimateTokens(text: string | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Estimate token count in Content array
 * Note: thoughtSignature on functionCall parts can be 500+ tokens each!
 */
function estimateContentsTokens(contents: Content[]): number {
  let total = 0
  for (const content of contents) {
    for (const part of content.parts || []) {
      const partAny = part as any
      if ('text' in part && part.text) {
        total += estimateTokens(part.text)
      } else if ('functionCall' in part) {
        total += estimateTokens(JSON.stringify(partAny.functionCall))
        // thoughtSignature is huge! Include it in estimate
        if (partAny.thoughtSignature) {
          total += estimateTokens(partAny.thoughtSignature)
        }
      } else if ('functionResponse' in part) {
        total += estimateTokens(JSON.stringify(partAny.functionResponse))
      }
    }
  }
  return total
}

/**
 * Convert Content[] to cache API format (preserves all part types including thoughtSignature)
 */
function contentsToCacheFormat(contents: Content[]): Array<{
  role: 'user' | 'model'
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any; thoughtSignature?: string }>
}> {
  return contents
    .map(c => ({
      role: (c.role === 'model' ? 'model' : 'user') as 'user' | 'model',
      parts: (c.parts || []).map(p => {
        const partAny = p as any
        if ('text' in p && p.text) {
          return { text: p.text }
        } else if ('functionCall' in p) {
          // Preserve thoughtSignature if present (required for thinking models)
          const part: any = { functionCall: partAny.functionCall }
          if (partAny.thoughtSignature) {
            part.thoughtSignature = partAny.thoughtSignature
          }
          return part
        } else if ('functionResponse' in p) {
          return { functionResponse: partAny.functionResponse }
        }
        return { text: '' } // fallback
      }).filter(p => p.text !== '' || p.functionCall || p.functionResponse)
    }))
    .filter(c => c.parts.length > 0)
}

/**
 * Generate a unique tool call ID
 */
function generateToolCallId(): string {
  return `call_${crypto.randomUUID()}`
}

/**
 * Native Gemini Provider using Google GenAI SDK
 */
export const GeminiNativeProvider: ProviderAdapter = {
  id: 'gemini',

  async agentStream({
    apiKey,
    model,
    system,
    messages,
    temperature,
    tools,
    responseSchema,
    emit,
    onChunk,
    onDone,
    onError,
    onTokenUsage,
    onToolStart,
    onToolEnd,
    onToolError,
    onStep,
    toolMeta,
    reasoningEffort,
    includeThoughts,
    thinkingBudget,
    geminiCacheMode,
    geminiCacheRefreshThreshold
  }): Promise<StreamHandle> {
    const client = new GoogleGenAI({ apiKey })
    let cancelled = false
    let loopResolve: () => void
    let loopReject: (err: Error) => void

    const loopPromise = new Promise<void>((resolve, reject) => {
      loopResolve = resolve
      loopReject = reject
    })

    const runLoop = async () => {
      try {
        const sessionId = toolMeta?.requestId || 'default'
        const hasTools = !!tools?.length

        debugLog({
          event: 'start',
          model,
          sessionId,
          hasTools,
          toolCount: tools?.length || 0,
          includeThoughts,
          reasoningEffort,
          thinkingBudget,
          supportsThinking: supportsExtendedThinking(model)
        })

        // Build tool map for execution
        const toolMap = new Map<string, AgentTool>()
        for (const tool of tools || []) {
          toolMap.set(tool.name, tool)
        }

        // Convert messages to Gemini format
        const allContents = toGeminiContents(messages || [])
        const geminiTools = hasTools ? toGeminiTools(tools) : undefined

        // System instruction
        const systemText = typeof system === 'string' ? system : ''

        // Split contents: cache all but the last message, send last message fresh
        // This ensures the model has something to respond to
        const contentsToCache = allContents.length > 1 ? allContents.slice(0, -1) : []
        const lastContent = allContents.length > 0 ? allContents[allContents.length - 1] : null

        // Compute hash of message content for cache invalidation (based on cacheable portion)
        const messageHash = computeMessageHash(contentsToCache)

        // Try to get or create explicit cache
        let cacheRef: GeminiCacheRef | null = null

        // Estimate tokens to check if we should use explicit caching
        // Include messages in token estimate now that we cache them
        let totalTokens = estimateTokens(systemText)
        if (geminiTools?.length) {
          totalTokens += estimateTokens(JSON.stringify(geminiTools))
        }
        for (const content of contentsToCache) {
          for (const part of content.parts || []) {
            if ('text' in part && part.text) {
              totalTokens += estimateTokens(part.text)
            }
          }
        }

        // Use explicit caching only if mode is not 'implicit'
        const useExplicitCaching = geminiCacheMode !== 'implicit' && totalTokens >= MIN_CACHE_TOKENS

        if (geminiCacheMode === 'implicit') {
          debugLog({
            event: 'cache_mode_implicit',
            reason: 'Using implicit caching mode (automatic, probabilistic)'
          })
        }

        if (useExplicitCaching) {
          // Check for existing cache (includes message hash check)
          cacheRef = geminiCacheStore.get(sessionId, model, messageHash)

          debugLog({
            event: 'cache_check',
            sessionId,
            model,
            messageHash,
            messageCount: contentsToCache.length,
            existingCache: cacheRef?.name || 'none',
            isExpired: cacheRef ? isCacheExpired(cacheRef) : 'n/a'
          })

          if (!cacheRef || isCacheExpired(cacheRef)) {
            // Create new cache with system + tools + messages
            try {
              cacheRef = await createGeminiCache({
                apiKey,
                model,
                systemInstruction: systemText,
                tools: tools?.map(t => ({
                  type: 'function' as const,
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                  }
                })),
                // Include message history in cache (all but the last message)
                // Convert to cache API format (role must be 'user' | 'model', parts must have text)
                contents: contentsToCache.length > 0 ? contentsToCache.map(c => ({
                  role: (c.role === 'model' ? 'model' : 'user') as 'user' | 'model',
                  parts: (c.parts || []).filter(p => 'text' in p && p.text).map(p => ({ text: (p as any).text as string }))
                })).filter(c => c.parts.length > 0) : undefined,
                ttlSeconds: CACHE_TTL_SECONDS,
                displayName: `hifide-${sessionId.slice(0, 8)}`
              })
              geminiCacheStore.set(sessionId, model, cacheRef, messageHash)
              debugLog({
                event: 'cache_created',
                cacheName: cacheRef.name,
                tokenCount: cacheRef.totalTokenCount,
                includesMessages: contentsToCache.length > 0,
                messageCount: contentsToCache.length,
                systemInstructionTokens: estimateTokens(systemText),
                toolsTokens: tools ? estimateTokens(JSON.stringify(tools)) : 0
              })
            } catch (err: any) {
              debugLog({
                event: 'cache_create_failed',
                error: err?.message || String(err)
              })
              cacheRef = null
            }
          } else {
            debugLog({
              event: 'cache_reused',
              cacheName: cacheRef.name,
              messageHash
            })
          }
        } else if (geminiCacheMode !== 'implicit') {
          // Only log cache skip due to token count if we're in explicit mode
          debugLog({
            event: 'cache_skip',
            totalTokens,
            minRequired: MIN_CACHE_TOKENS
          })
        }

        // When using cache, start with just the last message (history is in cache)
        // When not using cache, start with all messages
        let conversationContents: Content[] = cacheRef
          ? (lastContent ? [lastContent] : [])
          : allContents

        // Build generation config
        const generationConfig: any = {
          temperature: temperature ?? 0.7
        }

        // Add response schema if provided
        if (responseSchema) {
          generationConfig.responseMimeType = 'application/json'
          generationConfig.responseJsonSchema = responseSchema
        }

        // Add thinking configuration if supported and requested
        // Gemini 3 uses thinkingLevel (LOW/HIGH), Gemini 2.5 uses thinkingBudget + includeThoughts
        const isGemini3 = /gemini.*?(?:^|-)3[-.]|gemini-3/i.test(model)
        console.log('[gemini-native] Thinking config check:', {
          model,
          isGemini3,
          supportsThinking: supportsExtendedThinking(model),
          includeThoughts,
          reasoningEffort,
          thinkingBudget
        })
        if (supportsExtendedThinking(model) && includeThoughts) {
          if (isGemini3) {
            // Gemini 3 uses thinkingLevel enum: LOW, MEDIUM, HIGH, MINIMAL
            const thinkingLevel = reasoningEffort === 'low' ? 'LOW'
              : reasoningEffort === 'medium' ? 'MEDIUM'
              : 'HIGH'
            generationConfig.thinkingConfig = {
              thinkingLevel,
              includeThoughts: true
            }
            console.log('[gemini-native] Gemini 3 thinking ENABLED with level:', thinkingLevel)
          } else {
            // Gemini 2.5 uses thinkingBudget (integer)
            let budget = 1024 // default
            if (reasoningEffort === 'medium') budget = 8192
            else if (reasoningEffort === 'high') budget = 24576
            if (typeof thinkingBudget === 'number' && thinkingBudget > 0) {
              budget = thinkingBudget
            }
            generationConfig.thinkingConfig = {
              thinkingBudget: budget,
              includeThoughts: true
            }
            console.log('[gemini-native] Gemini 2.5 thinking ENABLED with budget:', budget)
          }
        } else {
          console.log('[gemini-native] Thinking NOT enabled')
        }

        // Build the config for generateContentStream
        // When using cache, system and tools are IN the cache, not in the request
        const config: any = {
          ...generationConfig,
          ...(cacheRef
            ? { cachedContent: cacheRef.name }
            : {
                systemInstruction: systemText || undefined,
                tools: geminiTools
              }
          )
        }

        debugLog({
          event: 'config',
          temperature: config.temperature,
          hasCachedContent: !!config.cachedContent,
          cachedContent: config.cachedContent,
          hasSystemInstruction: !!config.systemInstruction,
          hasTools: !!config.tools,
          hasThinkingConfig: !!config.thinkingConfig,
          thinkingConfig: config.thinkingConfig
        })

        // Agentic loop
        let stepCount = 0
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let totalCachedTokens = 0
        let totalReasoningTokens = 0

        // Log initial state before loop starts
        debugLog({
          event: 'agentic_loop_start',
          sessionId,
          model,
          usingCache: !!cacheRef,
          cacheName: cacheRef?.name || 'none',
          cacheTokenCount: cacheRef?.totalTokenCount || 0,
          initialConversationContents: conversationContents.length,
          initialFreshTokens: estimateContentsTokens(conversationContents),
          systemInstructionTokens: estimateTokens(systemText),
          toolCount: tools?.length || 0,
          toolDefinitionsTokens: tools ? estimateTokens(JSON.stringify(tools)) : 0
        })

        while (stepCount < MAX_AGENTIC_STEPS && !cancelled) {
          stepCount++

          // Stream the response
          let stepText = ''
          let stepReasoning = ''
          let stepToolCalls: any[] = []
          let stepInputTokens = 0
          let stepOutputTokens = 0
          let stepCachedTokens = 0
          let stepReasoningTokens = 0

          try {
            console.log(`[gemini-native] Step ${stepCount}: Calling generateContentStream...`)

            // Log exactly what we're sending to the model
            const requestPayload = {
              model,
              contents: conversationContents,
              config
            }

            // Debug: Log the actual config being sent
            console.log('[gemini-native] Request config:', {
              hasThinkingConfig: !!config.thinkingConfig,
              thinkingConfig: config.thinkingConfig,
              temperature: config.temperature,
              configKeys: Object.keys(config)
            })

            // Detailed breakdown of what's being sent
            const contentsBreakdown = conversationContents.map((c, i) => {
              const parts = (c.parts || []).map(p => {
                const pAny = p as any
                if ('text' in p && p.text) {
                  return { type: 'text', length: p.text.length, tokens: estimateTokens(p.text), preview: p.text.slice(0, 100) }
                } else if ('functionCall' in p) {
                  const fc = pAny.functionCall
                  return { type: 'functionCall', name: fc?.name, argsLength: JSON.stringify(fc?.args || {}).length }
                } else if ('functionResponse' in p) {
                  const fr = pAny.functionResponse
                  const responseStr = JSON.stringify(fr?.response || {})
                  return { type: 'functionResponse', name: fr?.name, responseLength: responseStr.length, tokens: estimateTokens(responseStr) }
                }
                return { type: 'unknown' }
              })
              return { index: i, role: c.role, partsCount: parts.length, parts }
            })

            debugLog({
              event: 'request_payload',
              stepCount,
              model,
              cachedContent: config.cachedContent || 'none',
              contentsCount: conversationContents.length,
              estimatedFreshTokens: estimateContentsTokens(conversationContents),
              contentsBreakdown
            })

            const streamResult = await client.models.generateContentStream(requestPayload)

            for await (const chunk of streamResult) {
              if (cancelled) break

              // Debug: Log raw chunk structure (first chunk only)
              if (stepText === '' && stepReasoning === '' && stepToolCalls.length === 0) {
                debugLog({
                  event: 'first_chunk',
                  stepCount,
                  chunk: JSON.parse(JSON.stringify(chunk)) // Deep clone to avoid circular refs
                })
                // Also log to console for immediate visibility
                console.log('[gemini-native] First chunk structure:', JSON.stringify(chunk, null, 2).slice(0, 2000))
              }

              // Process all parts from candidates
              const candidates = chunk.candidates || []
              for (const candidate of candidates) {
                const parts = candidate.content?.parts || []
                for (const part of parts) {
                  const partAny = part as any

                  // Debug: log all parts with text to understand the structure
                  if (part.text && DEBUG_THINKING) {
                    console.log('[gemini-native] Part with text:', {
                      hasThought: 'thought' in partAny,
                      thought: partAny.thought,
                      hasThoughtSignature: 'thoughtSignature' in partAny,
                      textPreview: part.text.slice(0, 100),
                      allKeys: Object.keys(partAny)
                    })
                  }

                  // Check if this is a thinking/thought part (native SDK marks these with thought: true)
                  if (partAny.thought === true && part.text) {
                    stepReasoning += part.text
                    // Emit reasoning event directly (same pattern as openai-compatible)
                    emit?.({ type: 'reasoning', provider: 'gemini', model, reasoning: part.text })
                    if (DEBUG_THINKING) console.log('[gemini-native] Emitted reasoning:', part.text.slice(0, 100))
                  }
                  // Regular text content (not thinking)
                  else if (part.text && !partAny.thought) {
                    stepText += part.text
                    // Use onChunk directly (legacy callback, still used by scheduler)
                    onChunk?.(part.text)
                  }

                  // Function calls
                  if (part.functionCall) {
                    // Capture thoughtSignature if present (required for thinking models)
                    stepToolCalls.push({
                      id: generateToolCallId(),
                      name: part.functionCall.name,
                      arguments: part.functionCall.args,
                      thoughtSignature: partAny.thoughtSignature
                    })
                  }
                }
              }

              // Extract usage from chunk
              const usage = chunk.usageMetadata
              if (usage) {
                stepInputTokens = usage.promptTokenCount || 0
                stepOutputTokens = usage.candidatesTokenCount || 0
                stepCachedTokens = usage.cachedContentTokenCount || 0
                // Capture reasoning tokens from thoughtsTokenCount
                const usageAny = usage as any
                // Debug: log all usage fields to see if thoughts are reported
                console.log('[gemini-native] Usage metadata:', {
                  promptTokenCount: usage.promptTokenCount,
                  candidatesTokenCount: usage.candidatesTokenCount,
                  cachedContentTokenCount: usage.cachedContentTokenCount,
                  thoughtsTokenCount: usageAny.thoughtsTokenCount,
                  allKeys: Object.keys(usageAny)
                })
                if (usageAny.thoughtsTokenCount) {
                  stepReasoningTokens = usageAny.thoughtsTokenCount
                }

              }
            }

            debugLog({
              event: 'step_complete',
              stepCount,
              textLength: stepText.length,
              reasoningLength: stepReasoning.length,
              toolCallCount: stepToolCalls.length,
              usage: {
                inputTokens: stepInputTokens,
                outputTokens: stepOutputTokens,
                cachedTokens: stepCachedTokens,
                reasoningTokens: stepReasoningTokens
              }
            })

          } catch (err: any) {
            const errorMsg = err?.message || String(err)
            console.error(`[gemini-native] Stream error:`, err)
            onError?.(errorMsg)
            throw err
          }

          // Accumulate usage
          totalInputTokens += stepInputTokens
          totalOutputTokens += stepOutputTokens
          totalCachedTokens = Math.max(totalCachedTokens, stepCachedTokens) // Cache is cumulative
          totalReasoningTokens += stepReasoningTokens

          // Report step token usage (same pattern as openai-compatible)
          // This enables per-step visibility and cost calculation
          if (onTokenUsage) {
            // Collect tool call arguments for output category tracking
            const toolCallArgs = stepToolCalls.map(tc => JSON.stringify(tc.arguments || {})).join('')

            // For thinking tokens, use API-reported thoughtsTokenCount (Gemini doesn't return
            // thinking as visible text for most models, only the token count)
            const thinkingTokens = stepReasoningTokens > 0
              ? stepReasoningTokens
              : (stepReasoning.length > 0 ? estimateTokens(stepReasoning) : 0)

            onTokenUsage({
              inputTokens: stepInputTokens,
              outputTokens: stepOutputTokens,
              totalTokens: stepInputTokens + stepOutputTokens,
              cachedTokens: stepCachedTokens,
              reasoningTokens: stepReasoningTokens > 0 ? stepReasoningTokens : undefined,
              stepCount,
              // Output token estimates for per-step category tracking
              stepOutput: {
                text: estimateTokens(stepText),
                reasoning: thinkingTokens, // Use API value, not text estimate
                toolCallArgs: estimateTokens(toolCallArgs)
              }
            })
          }

          // Report step completion
          onStep?.({
            text: stepText,
            reasoning: stepReasoning || undefined,
            toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined
          })

          // If no tool calls, we're done
          if (stepToolCalls.length === 0) {
            break
          }

          // Add assistant message with tool calls to history
          // Include thoughtSignature if present (required for thinking models like Gemini 2.5+)
          const toolCallParts: Part[] = stepToolCalls.map(call => {
            const part: any = {
              functionCall: {
                name: call.name,
                args: call.arguments
              }
            }
            // Preserve thoughtSignature for thinking models
            if (call.thoughtSignature) {
              part.thoughtSignature = call.thoughtSignature
            }
            return part
          })

          // Include any text before tool calls
          if (stepText) {
            conversationContents.push({
              role: 'model',
              parts: [{ text: stepText }, ...toolCallParts]
            })
          } else {
            conversationContents.push({
              role: 'model',
              parts: toolCallParts
            })
          }

          // Execute tool calls
          const toolResultParts: Part[] = []

          for (const call of stepToolCalls) {
            const tool = toolMap.get(call.name)
            if (!tool) {
              const error = `Unknown tool: ${call.name}`
              onToolError?.({ callId: call.id, name: call.name, error })
              toolResultParts.push({
                functionResponse: {
                  name: call.name,
                  response: { error }
                }
              })
              continue
            }

            onToolStart?.({ callId: call.id, name: call.name, arguments: call.arguments })

            try {
              const result = await tool.run(call.arguments, toolMeta)

              // Use toModelResult if available to reduce tokens
              let modelResult = result
              if (tool.toModelResult) {
                const converted = tool.toModelResult(result)
                modelResult = converted.minimal
              }

              onToolEnd?.({ callId: call.id, name: call.name, result: modelResult })

              toolResultParts.push({
                functionResponse: {
                  name: call.name,
                  response: typeof modelResult === 'string'
                    ? { result: modelResult }
                    : modelResult
                }
              })
            } catch (err: any) {
              const error = err?.message || String(err)
              onToolError?.({ callId: call.id, name: call.name, error })

              toolResultParts.push({
                functionResponse: {
                  name: call.name,
                  response: { error }
                }
              })
            }
          }

          // Add tool results to history
          conversationContents.push({
            role: 'user',
            parts: toolResultParts
          })

          // Mid-loop cache refresh: if fresh content is large, cache it for next step
          // This prevents token accumulation across many agentic steps
          const freshTokens = estimateContentsTokens(conversationContents)
          const effectiveRefreshThreshold = geminiCacheRefreshThreshold ?? CACHE_REFRESH_THRESHOLD_TOKENS
          if (freshTokens >= effectiveRefreshThreshold && cacheRef) {
            try {
              // Cache all contents except the last one (tool results we just added)
              const contentsToAddToCache = conversationContents.slice(0, -1)

              // Combine with previously cached contents (contentsToCache from initial setup)
              const allCacheContents = [...contentsToCache, ...contentsToAddToCache]

              debugLog({
                event: 'mid_loop_cache_refresh_start',
                stepCount,
                freshTokens,
                contentsToAddCount: contentsToAddToCache.length,
                totalCacheContents: allCacheContents.length
              })

              const newCacheRef = await createGeminiCache({
                apiKey,
                model,
                systemInstruction: systemText,
                tools: tools?.map(t => ({
                  type: 'function' as const,
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                  }
                })),
                contents: contentsToCacheFormat(allCacheContents),
                ttlSeconds: CACHE_TTL_SECONDS,
                displayName: `hifide-${sessionId.slice(0, 8)}-step${stepCount}`
              })

              // Update cache reference and config
              cacheRef = newCacheRef
              config.cachedContent = newCacheRef.name

              // Reset conversationContents to just the tool results (what needs to be sent fresh)
              conversationContents = [conversationContents[conversationContents.length - 1]]

              // Update contentsToCache to include what we just cached
              contentsToCache.push(...contentsToAddToCache)

              debugLog({
                event: 'mid_loop_cache_refresh_done',
                stepCount,
                newCacheName: newCacheRef.name,
                newCacheTokens: newCacheRef.totalTokenCount,
                freshContentsRemaining: conversationContents.length
              })
            } catch (err: any) {
              // If cache refresh fails, continue with accumulated fresh content
              debugLog({
                event: 'mid_loop_cache_refresh_failed',
                stepCount,
                error: err?.message || String(err)
              })
            }
          }
        }

        // Note: Per-step usage is already emitted in the loop above
        // This allows turn-by-turn token tracking with cost calculation

        onDone?.()
        loopResolve!()

      } catch (err: any) {
        const errorMsg = err?.message || String(err)
        onError?.(errorMsg)
        loopReject!(err)
      }
    }

    // Start the loop
    runLoop()

    return {
      cancel: () => {
        cancelled = true
      },
      _loopPromise: loopPromise
    }
  }
}

export default GeminiNativeProvider
