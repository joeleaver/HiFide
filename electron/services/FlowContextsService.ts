import { Service } from './base/Service'
import type { MainFlowContext } from '../flow-engine/types'
import { broadcastWorkspaceNotification } from '../backend/ws/broadcast.js'

interface WorkspaceContextsState {
  requestId: string | null
  mainContext: MainFlowContext | null
  isolatedContexts: Record<string, MainFlowContext>
  updatedAt: number
}

interface FlowContextsState {
  byWorkspace: Record<string, WorkspaceContextsState>
}

export class FlowContextsService extends Service<FlowContextsState> {
  constructor() {
    super({ byWorkspace: {} })
  }

  protected onStateChange(): void {
    // No-op – broadcasting is handled in the explicit mutators below
  }

  getContextsFor(params: { workspaceId: string }): WorkspaceContextsState {
    const existing = this.state.byWorkspace[params.workspaceId]
    if (existing) return existing
    return {
      requestId: null,
      mainContext: null,
      isolatedContexts: {},
      updatedAt: 0,
    }
  }

  setContextsFor(params: {
    workspaceId: string
    requestId: string
    mainContext: MainFlowContext | null
    isolatedContexts?: Record<string, MainFlowContext>
  }): void {
    const isolated = this.cloneIsolated(params.isolatedContexts)
    const entry: WorkspaceContextsState = {
      requestId: params.requestId,
      mainContext: this.cloneContext(params.mainContext),
      isolatedContexts: isolated,
      updatedAt: Date.now(),
    }

    this.setState({
      byWorkspace: {
        ...this.state.byWorkspace,
        [params.workspaceId]: entry,
      },
    })

    this.emit('contexts:changed', { workspaceId: params.workspaceId, ...entry })

    try {
      broadcastWorkspaceNotification(params.workspaceId, 'flow.contexts.changed', {
        requestId: entry.requestId,
        updatedAt: entry.updatedAt,
        mainContext: entry.mainContext,
        isolatedContexts: entry.isolatedContexts,
      })
    } catch (error) {
      console.warn('[FlowContextsService] Failed to broadcast contexts:', error)
    }
  }

  clearContextsFor(params: { workspaceId: string; requestId?: string }): void {
    const existing = this.state.byWorkspace[params.workspaceId]
    if (!existing) return
    if (params.requestId && existing.requestId && existing.requestId !== params.requestId) {
      return
    }

    const next = { ...this.state.byWorkspace }
    delete next[params.workspaceId]

    this.setState({ byWorkspace: next })

    this.emit('contexts:changed', {
      workspaceId: params.workspaceId,
      requestId: null,
      mainContext: null,
      isolatedContexts: {},
      updatedAt: Date.now(),
    })

    try {
      broadcastWorkspaceNotification(params.workspaceId, 'flow.contexts.changed', {
        requestId: null,
        updatedAt: Date.now(),
        mainContext: null,
        isolatedContexts: {},
      })
    } catch (error) {
      console.warn('[FlowContextsService] Failed to broadcast clear:', error)
    }
  }

  private cloneContext(context: MainFlowContext | null): MainFlowContext | null {
    if (!context) return null
    return this.safeClone(context)
  }

  private cloneIsolated(map?: Record<string, MainFlowContext>): Record<string, MainFlowContext> {
    if (!map) return {}
    const out: Record<string, MainFlowContext> = {}
    for (const [contextId, ctx] of Object.entries(map)) {
      out[contextId] = this.safeClone(ctx)
    }
    return out
  }

  private safeClone<T>(value: T): T {
    if (typeof structuredClone === 'function') {
      return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value))
  }
}
