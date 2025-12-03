import crypto from 'node:crypto'
import { createContextManager, type ContextManager, type Message } from './contextManager'
import type { MainFlowContext } from './types'
import type { CreateIsolatedContextOptions } from './context-options'

export interface ContextBinding {
  contextId: string
  contextType: 'main' | 'isolated'
  ref: { current: MainFlowContext }
  manager: ContextManager
}

export class ContextRegistry {
  private contextBindings = new Map<string, ContextBinding>()
  private mainBinding: ContextBinding

  constructor(initialContext: MainFlowContext) {
    this.mainBinding = this.registerContextBinding(initialContext, 'main')
  }

  getMainBinding(): ContextBinding {
    return this.mainBinding
  }

  listBindings(): ContextBinding[] {
    return Array.from(this.contextBindings.values())
  }

  listSnapshots(): MainFlowContext[] {
    return this.listBindings().map(binding => this.cloneContext(binding.ref.current))
  }

  getContextSnapshot(contextId: string): MainFlowContext | undefined {
    const binding = this.contextBindings.get(contextId)
    return binding ? this.cloneContext(binding.ref.current) : undefined
  }

  resolveFromSnapshot(
    snapshot?: MainFlowContext,
    fallbackType: 'main' | 'isolated' = 'main',
    options?: { preferExisting?: boolean }
  ): ContextBinding {
    if (!snapshot) {
      return this.mainBinding
    }
    return this.upsertContextBindingFromSnapshot(snapshot, fallbackType, options)
  }

  ensureBindingForOutput(snapshot: MainFlowContext, fallbackType: 'main' | 'isolated'): ContextBinding {
    return this.upsertContextBindingFromSnapshot(snapshot, fallbackType)
  }

  createIsolatedContext(options: CreateIsolatedContextOptions, activeBinding: ContextBinding): ContextBinding {
    const baseBinding = this.resolveBaseBinding(options.baseContextId, activeBinding)
    const base = baseBinding?.ref.current ?? this.mainBinding.ref.current
    const inheritedHistory = options.inheritHistory ? this.cloneMessages(base.messageHistory as Message[]) : []
    const seededHistory = options.initialMessages?.length ? sanitizeMessages(options.initialMessages) : []
    const systemInstructions =
      options.systemInstructions !== undefined
        ? options.systemInstructions
        : options.inheritSystemInstructions
          ? base.systemInstructions
          : ''

    const isolated: MainFlowContext = {
      contextId: crypto.randomUUID(),
      contextType: 'isolated',
      provider: options.provider || base.provider,
      model: options.model || base.model,
      systemInstructions,
      ...(options.label ? { label: options.label } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.includeThoughts !== undefined ? { includeThoughts: options.includeThoughts } : {}),
      ...(options.thinkingBudget !== undefined ? { thinkingBudget: options.thinkingBudget } : {}),
      ...(options.modelOverrides?.length ? { modelOverrides: options.modelOverrides } : {}),
      parentContextId: base.contextId,
      createdByNodeId: options.createdByNodeId,
      createdAt: new Date().toISOString(),
      messageHistory: [...inheritedHistory, ...seededHistory],
    }
    return this.registerContextBinding(isolated, 'isolated')
  }

  releaseContext(contextId: string): boolean {
    if (!contextId || contextId === this.mainBinding.contextId) {
      return false
    }
    return this.contextBindings.delete(contextId)
  }

  captureState(): { mainContext: MainFlowContext | null; isolatedContexts: Record<string, MainFlowContext> } {
    const isolated: Record<string, MainFlowContext> = {}
    for (const [contextId, binding] of this.contextBindings.entries()) {
      if (binding.contextType === 'isolated') {
        isolated[contextId] = this.cloneContext(binding.ref.current)
      }
    }
    return {
      mainContext: this.cloneContext(this.mainBinding.ref.current),
      isolatedContexts: isolated,
    }
  }

  cloneContext(context: MainFlowContext): MainFlowContext {
    if (typeof structuredClone === 'function') {
      return structuredClone(context)
    }
    return JSON.parse(JSON.stringify(context))
  }

  private registerContextBinding(snapshot: MainFlowContext, defaultType: 'main' | 'isolated'): ContextBinding {
    const normalized = this.normalizeContextSnapshot(snapshot, defaultType)
    const ref = { current: normalized }
    const manager = createContextManager(ref)
    const binding: ContextBinding = {
      contextId: normalized.contextId,
      contextType: (normalized.contextType ?? defaultType) as 'main' | 'isolated',
      ref,
      manager,
    }
    this.contextBindings.set(binding.contextId, binding)
    if (binding.contextType === 'main') {
      this.mainBinding = binding
    }
    return binding
  }

  private upsertContextBindingFromSnapshot(
    snapshot: MainFlowContext,
    fallbackType: 'main' | 'isolated',
    options?: { preferExisting?: boolean }
  ): ContextBinding {
    const preferExisting = options?.preferExisting ?? false
    if (snapshot?.contextId) {
      const existing = this.contextBindings.get(snapshot.contextId)
      if (existing) {
        if (preferExisting || snapshot === existing.ref.current) {
          return existing
        }
        existing.ref.current = this.normalizeContextSnapshot(snapshot, existing.contextType)
        if (existing.contextType === 'main') {
          this.mainBinding = existing
        }
        return existing
      }
    }
    return this.registerContextBinding(snapshot, fallbackType)
  }

  private normalizeContextSnapshot(context: MainFlowContext, fallbackType: 'main' | 'isolated'): MainFlowContext {
    const history = this.cloneMessages(context.messageHistory as Message[])
    return {
      ...context,
      contextId: context.contextId || crypto.randomUUID(),
      contextType: (context.contextType ?? fallbackType) as 'main' | 'isolated',
      messageHistory: history,
    }
  }

  private resolveBaseBinding(contextId: string | undefined, fallback: ContextBinding): ContextBinding {
    if (contextId) {
      const binding = this.contextBindings.get(contextId)
      if (binding) {
        return binding
      }
    }
    return fallback || this.mainBinding
  }

  private cloneMessages(messages?: Message[]): Message[] {
    return sanitizeMessages(messages)
  }


}

const VALID_ROLES: Array<Message['role']> = ['system', 'user', 'assistant']
function sanitizeMessages(messages?: Message[]): Message[] {
  if (!Array.isArray(messages)) return []
  const sanitized: Message[] = []
  for (const msg of messages) {
    const normalized = sanitizeMessage(msg)
    if (normalized) {
      sanitized.push(normalized)
    }
  }
  return sanitized
}

function sanitizeMessage(message?: Message): Message | undefined {
  if (!message || typeof message.content !== 'string') {
    return undefined
  }
  const role: Message['role'] = VALID_ROLES.includes(message.role) ? message.role : 'assistant'
  const metadata = message.metadata ? { ...message.metadata } : undefined
  const normalized: Message = {
    ...message,
    role,
    content: String(message.content),
  }
  if (message.reasoning) {
    normalized.reasoning = String(message.reasoning)
  }
  if (metadata) {
    normalized.metadata = metadata
  } else if ('metadata' in normalized) {
    delete (normalized as any).metadata
  }
  return normalized
}
