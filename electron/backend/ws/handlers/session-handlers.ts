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

      const executedFlowId = sess.executedFlow || sess.lastUsedFlow || ''
      return {
        ok: true,
        meta: {
          id: sess.id,
          title: sess.title,
          executedFlowId,
          lastUsedFlowId: sess.lastUsedFlow || '',
          providerId: sess.currentContext?.provider || '',
          modelId: sess.currentContext?.model || '',
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
  // NOTE: This does NOT update FlowGraphService - that's for the editor only.
  // If editor is editing the same flow, flow.start will use the editor's graph.
  // If editor is editing a different flow, we load fresh from disk.
  addMethod('session.setExecutedFlow', async ({ sessionId, flowId }: { sessionId: string; flowId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()

      // Cancel any running flow for this session
      const { getActiveFlows, cancelFlow, executeFlow } = await import('../../../flow-engine/index.js')
      const activeFlows = getActiveFlows()
      for (const [requestId, scheduler] of activeFlows.entries()) {
        if ((scheduler as any).sessionId === sessionId) {
          console.log('[session.setExecutedFlow] Cancelling running flow for session:', sessionId, 'requestId:', requestId)
          await cancelFlow(requestId)
        }
      }

      // Update the session's executed flow FIRST
      await sessionService.setSessionExecutedFlowFor({ workspaceId, sessionId, flowId })

      // Check if editor is editing the same flow - if so, use editor's graph (picks up live edits)
      const { getFlowProfileService, getFlowGraphService } = await import('../../../services/index.js')
      const flowProfileService = getFlowProfileService()
      const flowGraphService = getFlowGraphService()

      const editorTemplateId = flowGraphService.getSelectedTemplateId({ workspaceId })
      let nodes: any[]
      let edges: any[]

      if (editorTemplateId === flowId) {
        // Same flow - use editor's current graph (includes unsaved edits)
        console.log('[session.setExecutedFlow] Using editor graph (same flow):', flowId)
        const graph = flowGraphService.getGraph({ workspaceId })
        nodes = graph.nodes
        edges = graph.edges
      } else {
        // Different flow - load fresh from disk
        console.log('[session.setExecutedFlow] Loading from disk (different flow):', flowId, 'editor has:', editorTemplateId)
        const profile = await flowProfileService.loadTemplate({ templateId: flowId })
        if (!profile) {
          console.warn('[session.setExecutedFlow] Failed to load flow template:', flowId)
          return { ok: false, error: 'Failed to load flow template' }
        }
        nodes = profile.nodes
        edges = profile.edges
      }

      console.log('[session.setExecutedFlow] Flow template ready:', flowId, 'nodes:', nodes.length)

      // Get session and start the new flow
      const sessions = sessionService.getSessionsFor({ workspaceId })
      const session = sessions.find((s) => s.id === sessionId)
      if (!session?.currentContext) {
        return { ok: true } // Flow loaded but no context to start with
      }

      // Convert edges and execute flow
      const { reactFlowEdgesToFlowEdges } = await import('../../../services/flowConversion.js')
      const flowEdges = reactFlowEdgesToFlowEdges(edges)

      const crypto = await import('crypto')
      const requestId = crypto.randomUUID()

      // Get WebContents for this connection
      const { BrowserWindow } = await import('electron')
      const meta = activeConnections.get(connection)
      const wc = meta?.windowId ? BrowserWindow.fromId(meta.windowId)?.webContents : undefined

      // Execute the new flow
      executeFlow(wc, {
        requestId,
        flowDef: { nodes, edges: flowEdges },
        sessionId,
        workspaceId,
        initialContext: {
          provider: session.currentContext.provider,
          model: session.currentContext.model,
          systemInstructions: session.currentContext.systemInstructions,
          messageHistory: session.currentContext.messageHistory || [],
        },
      })

      console.log('[session.setExecutedFlow] Started new flow:', flowId, 'requestId:', requestId)
      return { ok: true, requestId }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Set provider/model for session
  // Also updates any active flow scheduler for this session so the next LLM request uses the new model
  addMethod('session.setProviderModel', async ({ sessionId, providerId, modelId }: { sessionId: string; providerId: string; modelId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      await sessionService.setSessionProviderModelFor({ workspaceId, sessionId, provider: providerId, model: modelId })

      // Update any active flow scheduler for this session so next LLM request uses new provider/model
      const { updateActiveFlowProviderModelForSession } = await import('../../../flow-engine/index.js')
      updateActiveFlowProviderModelForSession(sessionId, providerId, modelId)

      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

