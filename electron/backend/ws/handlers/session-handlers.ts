/**
 * Session RPC handlers
 *
 * Handles session operations using SessionService
 */

import { getSessionService } from '../../../services/index.js'
import { getConnectionWorkspaceId, activeConnections } from '../broadcast.js'
import type { RpcConnection } from '../types'

/**
 * Create session-related RPC handlers
 */
export function createSessionHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  // Get current session
  addMethod('session.getCurrent', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const sid = sessionService.getCurrentIdFor({ workspaceId })
      if (!sid) return null

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const sess = sessions.find((s) => s.id === sid)
      if (!sess) return null

      return {
        id: sess.id,
        title: sess.title,
        items: sess.items,
        currentContext: sess.currentContext,
        tokenUsage: sess.tokenUsage,
        costs: sess.costs,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // List sessions
  addMethod('session.list', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const list = sessionService.getSessionsFor({ workspaceId })
      const sessions = list.map((s) => ({ id: s.id, title: s.title }))
      const currentId = sessionService.getCurrentIdFor({ workspaceId })
      return { ok: true, sessions, currentId }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Select session
  addMethod('session.select', async ({ id }: { id: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()

      // Cancel any running flows before switching sessions
      try {
        const { listActiveFlows, cancelFlow } = await import('../../../flow-engine/index.js')
        const activeFlows = listActiveFlows()
        for (const requestId of activeFlows) {
          await cancelFlow(requestId)
        }
      } catch (err) {
        console.error('[session.select] Failed to cancel active flows:', err)
      }

      await sessionService.selectFor({ workspaceId, id })

      // Auto-start flow for selected session
      try {
        const { getFlowGraphService } = await import('../../../services/index.js')
        const { executeFlow } = await import('../../../flow-engine/index.js')
        const { BrowserWindow } = await import('electron')
        const crypto = await import('crypto')

        const flowGraphService = getFlowGraphService()
        const graph = flowGraphService.getGraph({ workspaceId })

        if (graph.nodes && graph.nodes.length > 0) {
          const sessions = sessionService.getSessionsFor({ workspaceId })
          const session = sessions.find((s) => s.id === id)

          if (session?.currentContext) {
            const requestId = crypto.randomUUID()
            const meta = activeConnections.get(connection)
            const wc = meta?.windowId ? BrowserWindow.fromId(meta.windowId)?.webContents : undefined

            console.log('[session.select] Auto-starting flow for selected session:', id)

            // Convert ReactFlow edges to flow-engine edges
            const { reactFlowEdgesToFlowEdges } = await import('../../../services/flowConversion.js')
            const flowEdges = reactFlowEdgesToFlowEdges(graph.edges)

            // Start flow execution (don't await - it runs indefinitely)
            executeFlow(wc, {
              requestId,
              flowDef: { nodes: graph.nodes, edges: flowEdges },
              sessionId: id,
              workspaceId,
              initialContext: {
                provider: session.currentContext.provider,
                model: session.currentContext.model,
                systemInstructions: session.currentContext.systemInstructions,
                messageHistory: session.currentContext.messageHistory || [],
              },
            }).catch((err) => {
              console.error('[session.select] Flow execution error:', err)
            })
          }
        }
      } catch (err) {
        console.error('[session.select] Failed to auto-start flow:', err)
      }

      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Create new session
  addMethod('session.new', async ({ title }: { title?: string } = {}) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()

      // Cancel any running flows before creating new session
      try {
        const { listActiveFlows, cancelFlow } = await import('../../../flow-engine/index.js')
        const activeFlows = listActiveFlows()
        for (const requestId of activeFlows) {
          await cancelFlow(requestId)
        }
      } catch (err) {
        console.error('[session.new] Failed to cancel active flows:', err)
      }

      const id = await sessionService.newSessionFor({ workspaceId, title })

      // Return updated sessions list and current ID (UI expects this format)
      const list = sessionService.getSessionsFor({ workspaceId })
      const sessions = list.map((s) => ({ id: s.id, title: s.title }))
      const currentId = sessionService.getCurrentIdFor({ workspaceId })

      // Send notification to update other windows
      connection.sendNotification('session.selected', { id: currentId })

      // Auto-start flow for new session
      try {
        const { getFlowGraphService } = await import('../../../services/index.js')
        const { executeFlow } = await import('../../../flow-engine/index.js')
        const { BrowserWindow } = await import('electron')
        const crypto = await import('crypto')

        const flowGraphService = getFlowGraphService()
        const graph = flowGraphService.getGraph({ workspaceId })

        if (graph.nodes && graph.nodes.length > 0) {
          const session = list.find((s) => s.id === id)

          if (session?.currentContext) {
            const requestId = crypto.randomUUID()
            const meta = activeConnections.get(connection)
            const wc = meta?.windowId ? BrowserWindow.fromId(meta.windowId)?.webContents : undefined

            console.log('[session.new] Auto-starting flow for new session:', id)

            // Convert ReactFlow edges to flow-engine edges
            const { reactFlowEdgesToFlowEdges } = await import('../../../services/flowConversion.js')
            const flowEdges = reactFlowEdgesToFlowEdges(graph.edges)

            // Start flow execution (don't await - it runs indefinitely)
            executeFlow(wc, {
              requestId,
              flowDef: { nodes: graph.nodes, edges: flowEdges },
              sessionId: id,
              workspaceId,
              initialContext: {
                provider: session.currentContext.provider,
                model: session.currentContext.model,
                systemInstructions: session.currentContext.systemInstructions,
                messageHistory: session.currentContext.messageHistory || [],
              },
            }).catch((err) => {
              console.error('[session.new] Flow execution error:', err)
            })
          }
        }
      } catch (err) {
        console.error('[session.new] Failed to auto-start flow:', err)
      }

      return { ok: true, id, sessions, currentId }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Get current session metadata
  addMethod('session.getCurrentMeta', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const currentId = sessionService.getCurrentIdFor({ workspaceId })
      if (!currentId) return { ok: true, meta: null }

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const sess = sessions.find((s) => s.id === currentId)
      if (!sess) return { ok: true, meta: null }

      return {
        ok: true,
        meta: {
          id: sess.id,
          title: sess.title,
          provider: sess.currentContext?.provider || null,
          model: sess.currentContext?.model || null,
        },
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Get current session (strict - returns full session or error)
  addMethod('session.getCurrentStrict', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const sid = sessionService.getCurrentIdFor({ workspaceId })
      if (!sid) return { ok: false, error: 'No current session' }

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const sess = sessions.find((s) => s.id === sid)
      if (!sess) return { ok: false, error: 'Session not found' }

      return {
        ok: true,
        id: sess.id,
        title: sess.title,
        items: sess.items,
        currentContext: sess.currentContext,
        tokenUsage: sess.tokenUsage,
        costs: sess.costs,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Set executed flow for session
  addMethod('session.setExecutedFlow', async ({ sessionId, flowId }: { sessionId: string; flowId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      await sessionService.setSessionExecutedFlowFor({ workspaceId, sessionId, flowId })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Set provider/model for session
  addMethod('session.setProviderModel', async ({ sessionId, providerId, modelId }: { sessionId: string; providerId: string; modelId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      await sessionService.setSessionProviderModelFor({ workspaceId, sessionId, provider: providerId, model: modelId })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

