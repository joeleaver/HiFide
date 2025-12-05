import type { MainFlowContext, NodeOutput } from './types'
import type { CreateIsolatedContextOptions } from './context-options'
import { ContextRegistry, type ContextBinding } from './contextRegistry'
import type { FlowContextsService } from '../services/FlowContextsService'

interface ContextLifecycleOptions {
  initialContext: MainFlowContext
  requestId: string
  workspaceId?: string
  flowContextsService: FlowContextsService
}

export class ContextLifecycleManager {
  private readonly contextRegistry: ContextRegistry
  private readonly flowContextsService: FlowContextsService
  private readonly requestId: string
  private readonly workspaceId?: string

  private mainBinding: ContextBinding

  constructor(options: ContextLifecycleOptions) {
    this.contextRegistry = new ContextRegistry(options.initialContext)
    this.mainBinding = this.contextRegistry.getMainBinding()
    this.flowContextsService = options.flowContextsService
    this.requestId = options.requestId
    this.workspaceId = options.workspaceId

    this.publishContextState()
  }

  getContextRegistry(): ContextRegistry {
    return this.contextRegistry
  }

  getMainBinding(): ContextBinding {
    return this.mainBinding
  }

  getMainContext(): MainFlowContext {
    return this.mainBinding.ref.current
  }

  resolveActiveBinding(pushedInputs: Record<string, any>): ContextBinding {
    const pushed = pushedInputs?.context as MainFlowContext | undefined
    if (!pushed) {
      if (pushedInputs) {
        pushedInputs.context = this.mainBinding.ref.current
      }
      return this.mainBinding
    }

    if (pushed === this.mainBinding.ref.current) {
      if (pushedInputs) {
        pushedInputs.context = this.mainBinding.ref.current
      }
      return this.mainBinding
    }

    const fallbackType = pushed.contextType === 'isolated' ? 'isolated' : 'main'
    const binding = this.contextRegistry.resolveFromSnapshot(pushed, fallbackType, { preferExisting: true })

    if (binding.contextType === 'main') {
      this.mainBinding = binding
    }

    if (pushedInputs) {
      pushedInputs.context = binding.ref.current
    }
    return binding
  }

  ensureContextOutput(result: NodeOutput, activeBinding: ContextBinding): ContextBinding {
    if (!result.context) {
      result.context = activeBinding.ref.current
      return activeBinding
    }

    if (result.context === activeBinding.ref.current) {
      return activeBinding
    }

    const binding = this.contextRegistry.ensureBindingForOutput(
      result.context,
      result.context.contextType === 'isolated' ? 'isolated' : activeBinding.contextType
    )

    if (binding.contextType === 'main') {
      this.mainBinding = binding
    }

    result.context = binding.ref.current
    return binding
  }

  createIsolatedContext(options: CreateIsolatedContextOptions, activeBinding: ContextBinding): MainFlowContext {
    const binding = this.contextRegistry.createIsolatedContext(options, activeBinding)
    this.publishContextState()
    return this.contextRegistry.cloneContext(binding.ref.current)
  }

  releaseContext(contextId: string): boolean {
    if (!contextId) return false
    const released = this.contextRegistry.releaseContext(contextId)
    if (released) {
      this.publishContextState()
    }
    return released
  }

  captureState(): { mainContext: MainFlowContext | null; isolatedContexts: Record<string, MainFlowContext> } {
    return this.contextRegistry.captureState()
  }

  publishContextState(): void {
    if (!this.workspaceId) return
    try {
      const snapshot = this.captureState()
      this.flowContextsService.setContextsFor({
        workspaceId: this.workspaceId,
        requestId: this.requestId,
        mainContext: snapshot.mainContext,
        isolatedContexts: snapshot.isolatedContexts,
      })
    } catch (error) {
      console.warn('[FlowScheduler] Failed to publish context state:', error)
    }
  }

  clearContextState(): void {
    if (!this.workspaceId) return
    try {
      this.flowContextsService.clearContextsFor({
        workspaceId: this.workspaceId,
        requestId: this.requestId,
      })
    } catch (error) {
      console.warn('[FlowScheduler] Failed to clear context state:', error)
    }
  }

  updateProviderModel(provider?: string, model?: string): void {
    const main = this.getMainContext()
    if (provider) {
      main.provider = provider
    }
    if (model) {
      main.model = model
    }
  }
}
