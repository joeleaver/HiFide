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
 * - provider: string - Provider to use for classification
 * - model: string - Model to use for classification
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'
import { llmService } from '../llm-service'
import { useMainStore } from '../../../store'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Uses an LLM to classify user input into one of several configured intents, then routes the flow to the corresponding output.'
}

/**
 * Node implementation
 */
export const intentRouterNode: NodeFunction = async (contextIn, dataIn, _inputs, config) => {
  const message = dataIn as string
  const nodeId = (config as any)?._nodeId || 'intentRouter'

  if (!message) {
    throw new Error('intentRouter node requires data input (user message)')
  }

  const routes = config.routes as Record<string, string> | undefined
  if (!routes || Object.keys(routes).length === 0) {
    throw new Error('intentRouter node requires at least one intent in config.routes')
  }

  // Get provider and model from node config (NOT from context)
  // Intent router uses its own LLM for classification, independent of conversation context
  const provider = config.provider as string | undefined
  const model = config.model as string | undefined

  if (!provider || !model) {
    throw new Error('intentRouter node requires provider and model in config')
  }

  // Build classification prompt
  const intentList = Object.entries(routes)
    .map(([intent, description]) => `- ${intent}: ${description}`)
    .join('\n')

  const classificationPrompt = `You are an intent classifier. Given a user message, classify it into one of the following intents:

${intentList}

User message: "${message}"

Choose the intent that best matches the user's message.`

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

  // Call LLM service for classification
  const llmResult = await llmService.chat({
    message: classificationPrompt,
    context: contextIn,
    nodeId,
    responseSchema,
    overrideProvider: provider,
    overrideModel: model,
    skipHistory: true, // Don't add classification to conversation history
    tools: [] // No tools needed for classification
  })

  if (llmResult.error) {
    throw new Error(`Intent classification failed: ${llmResult.error}`)
  }

  // Parse structured JSON response
  let parsedResponse: { intent: string }
  try {
    parsedResponse = JSON.parse(llmResult.text)
  } catch (e) {
    throw new Error(`Failed to parse intent classification response as JSON: ${llmResult.text}`)
  }

  const matchedIntent = parsedResponse.intent
  if (!matchedIntent || !intentKeys.includes(matchedIntent)) {
    throw new Error(`Invalid intent returned from LLM: ${matchedIntent}. Expected one of: ${intentKeys.join(', ')}`)
  }

  // Send intent detection event with provider/model info
  useMainStore.getState().feHandleIntentDetected(nodeId, matchedIntent, provider, model)

  // Return outputs only for the matched intent
  // All other intent outputs are undefined (won't trigger their successors)
  return {
    context: contextIn,
    data: message,
    status: 'success',
    [`${matchedIntent}-context`]: contextIn,
    [`${matchedIntent}-data`]: message
  }
}

