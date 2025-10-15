/**
 * intentRouter node
 *
 * Uses an LLM to classify user input into one of several configured intents,
 * then routes the flow to the corresponding output.
 *
 * Inputs:
 * - context: Execution context from predecessor (REQUIRED)
 * - data: User message to classify (REQUIRED)
 *
 * Outputs (dynamic based on config.routes):
 * For each intent in config.routes:
 * - {intent}-context: Context Out for this intent
 * - {intent}-data: Data Out for this intent
 *
 * Config:
 * - routes: Record<string, string> - Map of intent names to descriptions
 *   Example: { "greeting": "User is greeting or saying hello", "question": "User is asking a question" }
 */

import type { NodeFunction } from '../types'
import { providers } from '../../../core/state'
import { getProviderKey } from '../../../core/state'
import { sendFlowEvent } from '../events'

export const intentRouterNode: NodeFunction = async (contextIn, dataIn, _inputs, config) => {
  const message = dataIn as string
  const nodeId = (config as any)?._nodeId || 'intentRouter'

  console.log(`[intentRouter:${nodeId}] Starting classification`)
  console.log(`[intentRouter:${nodeId}] Input message:`, message?.substring(0, 100))

  if (!message) {
    throw new Error('intentRouter node requires data input (user message)')
  }

  const routes = config.routes as Record<string, string> | undefined
  if (!routes || Object.keys(routes).length === 0) {
    throw new Error('intentRouter node requires at least one intent in config.routes')
  }

  console.log(`[intentRouter:${nodeId}] Configured intents:`, Object.keys(routes))

  // Get provider and model from node config (NOT from context)
  // Intent router uses its own LLM for classification, independent of conversation context
  const provider = config.provider as string | undefined
  const model = config.model as string | undefined

  console.log(`[intentRouter:${nodeId}] Using provider:`, provider, 'model:', model)

  if (!provider || !model) {
    throw new Error('intentRouter node requires provider and model in config')
  }

  // Get API key (async!)
  const apiKey = await getProviderKey(provider)
  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`)
  }

  console.log(`[intentRouter:${nodeId}] API key retrieved:`, apiKey ? apiKey.substring(0, 10) + '...' : 'none')

  // Build classification prompt
  const intentList = Object.entries(routes)
    .map(([intent, description]) => `- ${intent}: ${description}`)
    .join('\n')

  const classificationPrompt = `You are an intent classifier. Given a user message, classify it into one of the following intents:

${intentList}

User message: "${message}"

Choose the intent that best matches the user's message.`

  console.log(`[intentRouter:${nodeId}] Classification prompt:`, classificationPrompt.substring(0, 200) + '...')

  // Build JSON schema for structured output - enforce one of the valid intents
  const intentKeys = Object.keys(routes)
  const responseSchema = {
    name: 'intent_classification',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: intentKeys,
          description: 'The classified intent from the user message'
        }
      },
      required: ['intent'],
      additionalProperties: false
    }
  }

  console.log(`[intentRouter:${nodeId}] Response schema:`, JSON.stringify(responseSchema, null, 2))

  // Call LLM for classification using agentStream with structured output
  const providerImpl = providers[provider]
  if (!providerImpl?.agentStream) {
    throw new Error(`Provider ${provider} does not support agentStream (required for structured output)`)
  }

  console.log(`[intentRouter:${nodeId}] Calling LLM for classification with structured output...`)

  let response = ''
  let chunkCount = 0
  await new Promise<void>((resolve, reject) => {
    providerImpl.agentStream!({
      apiKey,
      model,
      messages: [{ role: 'user', content: classificationPrompt }],
      tools: [], // No tools needed for classification
      responseSchema, // Enforce structured output
      onChunk: (text: string) => {
        chunkCount++
        console.log(`[intentRouter:${nodeId}] ========== Chunk #${chunkCount} ==========`)
        console.log(`[intentRouter:${nodeId}] Chunk text:`, JSON.stringify(text))
        console.log(`[intentRouter:${nodeId}] Current response:`, JSON.stringify(response))

        // Skip if this chunk is identical to what we already have
        if (text === response) {
          console.log(`[intentRouter:${nodeId}] ⚠️ Skipping duplicate chunk (identical to current response)`)
          return
        }

        // For structured output, each chunk might be the complete JSON
        // Try to parse the chunk itself first
        try {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && 'intent' in parsed) {
            console.log(`[intentRouter:${nodeId}] ✓ Chunk is complete valid JSON with intent field`)
            // Only replace if we don't already have a valid response
            if (!response) {
              console.log(`[intentRouter:${nodeId}] → Setting response to this chunk`)
              response = text
            } else {
              console.log(`[intentRouter:${nodeId}] → Already have response, skipping this chunk`)
            }
            return
          }
        } catch (e) {
          // Not valid JSON on its own, continue with concatenation
          console.log(`[intentRouter:${nodeId}] ✗ Chunk is not valid JSON, will concatenate`)
        }

        response += text
        console.log(`[intentRouter:${nodeId}] → Response after concatenation:`, JSON.stringify(response))
      },
      onDone: () => {
        console.log(`[intentRouter:${nodeId}] LLM call completed, total chunks: ${chunkCount}`)
        resolve()
      },
      onError: (error: string) => {
        console.error(`[intentRouter:${nodeId}] LLM error:`, error)
        reject(new Error(error))
      },
      onTokenUsage: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
        console.log(`[intentRouter:${nodeId}] Token usage:`, usage)
        // Send token usage event to renderer
        if (contextIn._wc && contextIn._requestId) {
          sendFlowEvent(contextIn._wc, contextIn._requestId, {
            type: 'tokenUsage',
            nodeId,
            provider,
            model,
            usage
          })
        }
      }
    })
  })

  console.log(`[intentRouter:${nodeId}] Full LLM response:`, JSON.stringify(response))

  // Parse structured JSON response
  let parsedResponse: { intent: string }
  try {
    parsedResponse = JSON.parse(response)
    console.log(`[intentRouter:${nodeId}] Parsed response:`, parsedResponse)
  } catch (e) {
    console.error(`[intentRouter:${nodeId}] Failed to parse response:`, response)
    throw new Error(`Failed to parse intent classification response as JSON: ${response}`)
  }

  const matchedIntent = parsedResponse.intent
  if (!matchedIntent || !intentKeys.includes(matchedIntent)) {
    throw new Error(`Invalid intent returned from LLM: ${matchedIntent}. Expected one of: ${intentKeys.join(', ')}`)
  }

  console.log(`[intentRouter:${nodeId}] Matched intent:`, matchedIntent)
  console.log(`[intentRouter:${nodeId}] Context has _wc:`, !!contextIn._wc, '_requestId:', contextIn._requestId)
  console.log(`[intentRouter:${nodeId}] Sending intentDetected event for:`, matchedIntent)

  // Send intent detection event
  if (contextIn._wc && contextIn._requestId) {
    console.log(`[intentRouter:${nodeId}] ✓ Sending intentDetected event to renderer`)
    sendFlowEvent(contextIn._wc, contextIn._requestId, {
      type: 'intentDetected',
      nodeId,
      intent: matchedIntent
    })
  } else {
    console.warn(`[intentRouter:${nodeId}] ⚠️ Cannot send intentDetected event - missing _wc or _requestId`)
  }

  console.log(`[intentRouter:${nodeId}] Routing to matched intent:`, matchedIntent)

  // Return outputs only for the matched intent
  // All other intent outputs are undefined (won't trigger their successors)
  const result: any = {
    context: contextIn,
    data: message,
    status: 'success',
    [`${matchedIntent}-context`]: contextIn,
    [`${matchedIntent}-data`]: message
  }

  console.log(`[intentRouter:${nodeId}] Returning result with outputs:`, Object.keys(result))

  return result
}

