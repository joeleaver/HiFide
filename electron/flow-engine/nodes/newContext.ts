/**
 * newContext node
 *
 * Creates an isolated execution context managed by the scheduler. Downstream
 * nodes receive the new context via the normal context edge.
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  pullOnly: true,
  description: 'Creates an isolated execution context for parallel branches.'
}

export const newContextNode: NodeFunction = async (flow, _context, dataIn, inputs, config) => {
  const provider = (config.provider as string) || 'openai'
  const model = (config.model as string) || 'gpt-4o'
  const temperature = typeof config.temperature === 'number' ? config.temperature : undefined
  const reasoningEffort = config.reasoningEffort as ('low' | 'medium' | 'high') | undefined
  const includeThoughts = config.includeThoughts === true
  const thinkingBudget = typeof config.thinkingBudget === 'number' ? config.thinkingBudget : undefined
  const modelOverrides = Array.isArray(config.modelOverrides) ? config.modelOverrides : undefined

  let systemInstructions = typeof config.systemInstructions === 'string' ? config.systemInstructions : ''
  if (inputs?.has?.('systemInstructionsIn')) {
    try {
      const dynamic = await inputs.pull('systemInstructionsIn')
      if (typeof dynamic === 'string') {
        systemInstructions = dynamic
      }
    } catch {}
  }

  const isolated = flow.contexts.createIsolated({
    provider,
    model,
    systemInstructions,
    temperature,
    reasoningEffort,
    includeThoughts,
    thinkingBudget,
    modelOverrides,
  })

  return {
    context: isolated,
    data: dataIn,
    status: 'success' as const,
  }
}
