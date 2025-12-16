/**
 * llmRequest node
 *
 * Sends a message to the LLM and returns the response. Context mutations are
 * handled via the scheduler-owned ContextManager exposed on FlowAPI.
 */

import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'
import { llmService } from '../llm-service'
import { markMemoriesUsed, retrieveWorkspaceMemoriesForQuery } from '../../store/utils/memories'

const DEFAULT_PROVIDER = 'openai'
const DEFAULT_MODEL = 'gpt-4o'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Sends a message to the configured LLM provider and returns the assistant response.'
}

export const llmRequestNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  const message = await resolveMessage(dataIn, inputs)
  if (!message) {
    flow.log.error('llmRequest: no message provided')
    return { status: 'error', error: 'No message provided to LLM Request node', context: flow.context.get() }
  }


  const manager = flow.context
  const snapshot = context ?? manager.get()

  ensureBaseProviderModel(manager, snapshot, config)
  applySamplingSettings(manager, config)

  const { providerOverride, modelOverride } = applyOverrides(manager, config)

  // Long-term RAG: retrieve workspace memories and inject into system instructions.
  // IMPORTANT: do NOT mutate flow.context.systemInstructions here, otherwise memories can
  // accumulate across turns and even interfere with later message resolution.
  let injectedSystemInstructions: string | undefined
  if (flow?.workspaceId) {
    try {
      const memories = await retrieveWorkspaceMemoriesForQuery(message, {
        workspaceId: flow.workspaceId,
        maxItems: 8,
        maxChars: 2400,
        minImportance: 0,
      })

      if (memories.length) {
        const base = manager.get()?.systemInstructions || ''

        const lines: string[] = []
        if (base && String(base).trim()) lines.push(String(base).trim())
        lines.push('')
        lines.push('## Relevant workspace memories')
        for (const m of memories) {
          const tags = Array.isArray(m.tags) && m.tags.length ? ` [tags: ${m.tags.join(', ')}]` : ''
          lines.push(`- (${m.type}, importance=${m.importance}) ${m.text}${tags} [memory:${m.id}]`)
        }

        injectedSystemInstructions = lines.filter(Boolean).join('\\n')

        // Mark used (best-effort)
        await markMemoriesUsed(memories.map((m) => m.id), { workspaceId: flow.workspaceId })
      }
    } catch (e: any) {
      flow.log.warn('llmRequest: failed to inject memories', { error: e?.message || String(e) })
    }
  }

  const tools = inputs.has('tools') ? await inputs.pull('tools') : undefined

  const result = await llmService.chat({
    message,
    tools,
    flowAPI: flow,
    overrideProvider: providerOverride,
    overrideModel: modelOverride,
    ...(injectedSystemInstructions ? { systemInstructions: injectedSystemInstructions } : {}),
  })

  if (result.error) {
    flow.log.error('llmRequest: LLM service error', { error: result.error })
    return { status: 'error', error: result.error, context: flow.context.get() }
  }

  return {
    context: flow.context.get(),
    data: result.text,
    status: 'success' as const,
  }
}

async function resolveMessage(dataIn: any, inputs: any): Promise<string> {
  if (typeof dataIn === 'string') return dataIn
  if (dataIn !== undefined && dataIn !== null) {
    return safeString(dataIn)
  }

  if (inputs?.has?.('data')) {
    const pulled = await inputs.pull('data')
    if (typeof pulled === 'string') return pulled
    if (pulled !== undefined && pulled !== null) {
      return safeString(pulled)
    }
  }

  return ''
}

function safeString(value: any): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function ensureBaseProviderModel(
  manager: { setProviderModel: (provider: string, model: string) => void; get: () => MainFlowContext },
  snapshot: MainFlowContext | undefined,
  config: Record<string, any>
): void {
  const provider = (snapshot?.provider || config.provider || DEFAULT_PROVIDER) as string
  const model = (snapshot?.model || config.model || DEFAULT_MODEL) as string
  manager.setProviderModel(provider, model)
}

function applySamplingSettings(manager: { update: (updates: Partial<MainFlowContext>) => void }, config: Record<string, any>): void {
  const updates: Partial<MainFlowContext> = {}
  if (typeof config.systemInstructions === 'string' && config.systemInstructions.trim()) {
    updates.systemInstructions = config.systemInstructions
  }
  if (typeof config.temperature === 'number') {
    (updates as any).temperature = config.temperature
  }
  if (config.reasoningEffort) {
    (updates as any).reasoningEffort = config.reasoningEffort
  }
  if (config.includeThoughts !== undefined) {
    (updates as any).includeThoughts = !!config.includeThoughts
  }
  if (typeof config.thinkingBudget === 'number') {
    (updates as any).thinkingBudget = config.thinkingBudget
  }
  if (Array.isArray(config.modelOverrides) && config.modelOverrides.length) {
    (updates as any).modelOverrides = config.modelOverrides
  }

  if (Object.keys(updates).length) {
    manager.update(updates)
  }
}

function applyOverrides(
  manager: {
    setProviderModel: (provider: string, model: string) => void
    update: (updates: Partial<MainFlowContext>) => void
    get: () => MainFlowContext
  },
  config: Record<string, any>
): { providerOverride?: string; modelOverride?: string } {
  if (!config.overrideEnabled) {
    return {}
  }

  const current = manager.get()
  let providerOverride = (config.overrideProvider as string) || current.provider
  let modelOverride = (config.overrideModel as string) || current.model

  // If provider changed but model not specified, keep the current model as best effort
  if (!modelOverride) {
    modelOverride = current.model
  }

  manager.setProviderModel(providerOverride || current.provider, modelOverride || current.model)

  const overrideUpdates: Partial<MainFlowContext> = {}
  if (typeof config.overrideTemperature === 'number') {
    (overrideUpdates as any).temperature = config.overrideTemperature
  }
  if (config.overrideReasoningEffort) {
    (overrideUpdates as any).reasoningEffort = config.overrideReasoningEffort
  }
  if (config.overrideIncludeThoughts !== undefined) {
    (overrideUpdates as any).includeThoughts = !!config.overrideIncludeThoughts
  }
  if (typeof config.overrideThinkingBudget === 'number') {
    (overrideUpdates as any).thinkingBudget = config.overrideThinkingBudget
  }
  if (Array.isArray(config.overrideModelOverrides) && config.overrideModelOverrides.length) {
    (overrideUpdates as any).modelOverrides = config.overrideModelOverrides
  }

  if (Object.keys(overrideUpdates).length) {
    manager.update(overrideUpdates)
  }

  return { providerOverride, modelOverride }
}
