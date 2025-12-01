/**
 * Flow Cache Service
 * 
 * Manages cached outputs for flow nodes to avoid redundant execution.
 * Cache is stored per-session and persisted to disk.
 */

import { Service } from './base/Service.js'
import { getSessionService } from './index.js'

interface FlowCacheState {
  // No in-memory state - cache is stored in sessions
}

export class FlowCacheService extends Service<FlowCacheState> {
  constructor() {
    super({})
  }

  protected onStateChange(): void {
    // No state to persist
  }

  /**
   * Get cached node output for a session
   */
  getNodeCacheFor(params: { workspaceId: string; sessionId: string; nodeId: string }): { data: any; timestamp: number } | undefined {
    const { workspaceId, sessionId, nodeId } = params
    const sessionService = getSessionService()
    const sessions = sessionService.getSessionsFor({ workspaceId })
    const session = sessions.find((s) => s.id === sessionId)
    if (!session || !session.flowCache) return undefined
    return session.flowCache[nodeId]
  }

  /**
   * Set cached node output for a session
   */
  async setNodeCacheFor(params: { workspaceId: string; sessionId: string; nodeId: string; cache: { data: any; timestamp: number } }): Promise<void> {
    const { workspaceId, sessionId, nodeId, cache } = params
    const sessionService = getSessionService()

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const updated = sessions.map((s: any) =>
      s.id === sessionId
        ? {
            ...s,
            flowCache: {
              ...s.flowCache,
              [nodeId]: cache,
            },
            updatedAt: Date.now(),
          }
        : s
    )

    sessionService.setSessionsFor({ workspaceId, sessions: updated })
    await sessionService.saveSessionFor({ workspaceId, sessionId }, true) // Immediate
  }

  /**
   * Clear cached node output for a session
   */
  async clearNodeCacheFor(params: { workspaceId: string; sessionId: string; nodeId: string }): Promise<void> {
    const { workspaceId, sessionId, nodeId } = params
    const sessionService = getSessionService()

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const session = sessions.find((s) => s.id === sessionId)
    if (!session || !session.flowCache) return

    const { [nodeId]: _, ...rest } = session.flowCache
    const updated = sessions.map((s: any) =>
      s.id === sessionId
        ? {
            ...s,
            flowCache: rest,
            updatedAt: Date.now(),
          }
        : s
    )

    sessionService.setSessionsFor({ workspaceId, sessions: updated })
    await sessionService.saveSessionFor({ workspaceId, sessionId }, true) // Immediate
  }

  /**
   * Clear all cached outputs for a session
   */
  async clearAllCacheFor(params: { workspaceId: string; sessionId: string }): Promise<void> {
    const { workspaceId, sessionId } = params
    const sessionService = getSessionService()

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const updated = sessions.map((s: any) =>
      s.id === sessionId
        ? {
            ...s,
            flowCache: {},
            updatedAt: Date.now(),
          }
        : s
    )

    sessionService.setSessionsFor({ workspaceId, sessions: updated })
    await sessionService.saveSessionFor({ workspaceId, sessionId }, true) // Immediate
  }
}

