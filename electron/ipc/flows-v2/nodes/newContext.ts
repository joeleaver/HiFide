/**
 * newContext node
 *
 * Creates a completely isolated execution context for parallel flows.
 * Useful for running separate conversations (e.g., bootstrap flows with cheap models)
 * that don't pollute the main conversation history.
 *
 * Inputs: None (entry node for isolated context)
 * Outputs:
 * - context: The new isolated execution context (teal color)
 * - data: None
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  pullOnly: true, // Don't auto-execute at flow start, only execute when pulled
  description: 'Creates an isolated execution context for parallel flows. Use for bootstrap flows or separate conversations that should not share message history with the main context.'
}

/**
 * Node implementation
 */
export const newContextNode: NodeFunction = async (flow, _context, dataIn, inputs, config) => {
  const provider = (config.provider as string) || 'openai'
  const model = (config.model as string) || 'gpt-4o'
  const sysFromConfig = (config.systemInstructions as string) || ''
  const temperature = (config as any)?.temperature as number | undefined
  const reasoningEffort = (config as any)?.reasoningEffort as ('low'|'medium'|'high') | undefined
  const includeThoughts = !!(config as any)?.includeThoughts
  const thinkingBudget = (config as any)?.thinkingBudget as number | undefined

  // Prefer dynamic input if connected, otherwise fall back to config
  let systemInstructions = sysFromConfig
  if (inputs.has('systemInstructionsIn')) {
    try {
      const v = await inputs.pull('systemInstructionsIn')
      if (typeof v === 'string') systemInstructions = v
    } catch {}
  }

  flow.log.info('Creating isolated context', {
    provider,
    model,
    systemInstructions: systemInstructions?.substring(0, 50)
  })

  // Create isolated context using ContextAPI
  const newContext = flow.context.create({
    provider,
    model,
    systemInstructions,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(includeThoughts === true ? { includeThoughts: true } : {}),
    ...(typeof thinkingBudget === 'number' ? { thinkingBudget } : {}),
  })

  // Mark as isolated and set deterministic id for testability
  const isolatedContext = flow.context.update(newContext, {
    contextType: 'isolated' as const,
    contextId: `context-${flow.nodeId}`
  } as any)
  flow.log.debug('Created context', { provider, model, contextId: (isolatedContext as any).contextId })

  return {
    context: isolatedContext,
    data: dataIn, // Pass through any data
    status: 'success'
  }
}

