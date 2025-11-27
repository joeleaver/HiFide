/**
 * Flow Cache Service
 * 
 * Manages cached outputs for flow nodes to avoid redundant execution.
 * Cache is stored per-session and persisted to disk.
 */

import { Service } from './base/Service.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

interface FlowCacheState {
  // No in-memory state - cache is stored in sessions
}

export class FlowCacheService extends Service<FlowCacheState> {
  constructor() {
    super({})
  }

  /**
   * Get cached node output for current session
   */
  getNodeCache(nodeId: string): { data: any; timestamp: number } | undefined {
    const sessionService = ServiceRegistry.get<any>('session')
    if (!sessionService) return undefined

    const session = sessionService.getCurrentSession()
    if (!session || !session.flowCache) return undefined
    return session.flowCache[nodeId]
  }

  /**
   * Set cached node output for current session
   */
  async setNodeCache(nodeId: string, cache: { data: any; timestamp: number }): Promise<void> {
    const sessionService = ServiceRegistry.get<any>('session')
    if (!sessionService) return

    const session = sessionService.getCurrentSession()
    if (!session) return

    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = sessionService.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s: any) =>
      s.id === session.id
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

    sessionService.setSessionsFor({ workspaceId: ws, sessions: updated })
    await sessionService.saveCurrentSession(true) // Immediate
  }

  /**
   * Clear cached node output for current session
   */
  async clearNodeCache(nodeId: string): Promise<void> {
    const sessionService = ServiceRegistry.get<any>('session')
    if (!sessionService) return

    const session = sessionService.getCurrentSession()
    if (!session || !session.flowCache) return

    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const { [nodeId]: _, ...rest } = session.flowCache
    const sessions = sessionService.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s: any) =>
      s.id === session.id
        ? {
            ...s,
            flowCache: rest,
            updatedAt: Date.now(),
          }
        : s
    )

    sessionService.setSessionsFor({ workspaceId: ws, sessions: updated })
    await sessionService.saveCurrentSession(true) // Immediate
  }

  /**
   * Clear all cached outputs for current session
   */
  async clearAllCache(): Promise<void> {
    const sessionService = ServiceRegistry.get<any>('session')
    if (!sessionService) return

    const session = sessionService.getCurrentSession()
    if (!session) return

    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = sessionService.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s: any) =>
      s.id === session.id
        ? {
            ...s,
            flowCache: {},
            updatedAt: Date.now(),
          }
        : s
    )

    sessionService.setSessionsFor({ workspaceId: ws, sessions: updated })
    await sessionService.saveCurrentSession(true) // Immediate
  }
}

