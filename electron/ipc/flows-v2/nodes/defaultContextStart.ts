/**
 * defaultContextStart node
 *
 * Entry point for the main conversation flow.
 * Uses global provider/model settings and optional system instructions.
 *
 * Inputs: None (entry node)
 * Outputs:
 * - context: The initialized execution context
 * - data: None
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // Entry node, no inputs needed
  description: 'Entry point for the main conversation flow. Uses global provider/model settings and optional system instructions.'
}

/**
 * Node implementation
 */
export const defaultContextStartNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // This is an entry node that creates the main context
  // It uses the global provider/model from the store

  // Get context - use pushed context from scheduler (which includes session message history),
  // or pull if edge connected, or create new from store
  let executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    // No context provided - create from store's current provider/model
    // This should rarely happen since scheduler now passes mainContext
    const provider = flow.store.selectedProvider || 'openai'
    const model = flow.store.selectedModel || 'gpt-4o'

    executionContext = flow.context.create({
      provider,
      model,
      systemInstructions: ''
    })

    flow.log.debug('Created new main context', {
      provider: executionContext.provider,
      model: executionContext.model
    })
  } else {
    flow.log.debug('Using context from scheduler', {
      provider: executionContext.provider,
      model: executionContext.model,
      messageHistoryLength: executionContext.messageHistory.length
    })
  }

  const systemInstructions = (config as any)?.systemInstructions

  flow.log.debug('Input context', {
    provider: executionContext.provider,
    model: executionContext.model,
    systemInstructions: executionContext.systemInstructions?.substring(0, 50),
    messageHistoryLength: executionContext.messageHistory.length
  })

  // Use ContextAPI to update system instructions (immutable)
  const outputContext = systemInstructions
    ? flow.context.update(executionContext, { systemInstructions })
    : executionContext

  flow.log.debug('Output context', {
    provider: outputContext.provider,
    model: outputContext.model,
    systemInstructions: outputContext.systemInstructions?.substring(0, 50),
    messageHistoryLength: outputContext.messageHistory.length
  })

  return {
    context: outputContext,
    status: 'success'
  }
}

