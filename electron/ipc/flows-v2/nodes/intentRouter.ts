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
export const intentRouterNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    flow.log.error('Context is required')
    throw new Error('intentRouter node requires a context input')
  }

  // Get message - use dataIn if provided (push), otherwise pull from input
  const message = (dataIn ?? (inputs.has('data') ? await inputs.pull('data') : '')) as string

  if (!message) {
    flow.log.error('intentRouter node requires data input (user message)')
    throw new Error('intentRouter node requires data input (user message)')
  }

  const routes = config.routes as Record<string, string> | undefined
  if (!routes || Object.keys(routes).length === 0) {
    flow.log.error('intentRouter node requires at least one intent in config.routes')
    throw new Error('intentRouter node requires at least one intent in config.routes')
  }

  // Get provider and model from node config (NOT from context)
  // Intent router uses its own LLM for classification, independent of conversation context
  const provider = config.provider as string | undefined
  const model = config.model as string | undefined

  if (!provider || !model) {
    flow.log.error('intentRouter node requires provider and model in config')
    throw new Error('intentRouter node requires provider and model in config')
  }

  flow.log.debug('Classifying intent', {
    message: message.substring(0, 50),
    provider,
    model,
    intents: Object.keys(routes)
  })

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
    context: executionContext,
    flowAPI: flow,
    responseSchema,
    overrideProvider: provider,
    overrideModel: model,
    skipHistory: true, // Don't add classification to conversation history
    tools: [] // No tools needed for classification
  })

  if (llmResult.error) {
    flow.log.error('Intent classification failed', { error: llmResult.error })
    throw new Error(`Intent classification failed: ${llmResult.error}`)
  }

  // Parse structured JSON response
  let parsedResponse: { intent: string }
  try {
    parsedResponse = JSON.parse(llmResult.text)
  } catch (e) {
    flow.log.error('Failed to parse intent classification response', {
      response: llmResult.text
    })
    throw new Error(`Failed to parse intent classification response as JSON: ${llmResult.text}`)
  }

  const matchedIntent = parsedResponse.intent
  if (!matchedIntent || !intentKeys.includes(matchedIntent)) {
    flow.log.error('Invalid intent returned from LLM', {
      matchedIntent,
      expected: intentKeys
    })
    throw new Error(`Invalid intent returned from LLM: ${matchedIntent}. Expected one of: ${intentKeys.join(', ')}`)
  }

  flow.log.info('Intent classified', { intent: matchedIntent })

  // Send intent detection event with provider/model info
  flow.store.feHandleIntentDetected(flow.nodeId, matchedIntent, provider, model)

  // Return outputs only for the matched intent
  // All other intent outputs are undefined (won't trigger their successors)
  return {
    context: executionContext,
    data: message,
    status: 'success',
    [`${matchedIntent}-context`]: executionContext,
    [`${matchedIntent}-data`]: message
  }
}

