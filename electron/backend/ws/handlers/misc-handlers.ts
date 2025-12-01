/**
 * Miscellaneous RPC handlers
 *
 * Handles tool results, edits preview, session metrics, indexing, and handshake
 */

import { activeConnections, getConnectionWorkspaceId } from '../broadcast.js'
import { UiPayloadCache } from '../../../core/uiPayloadCache.js'
import { loadWorkspace } from '../workspace-loader.js'
import type { RpcConnection } from '../types'

/**
 * Create miscellaneous RPC handlers
 */
export function createMiscHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  // Tool results
  addMethod('tool.getResult', async ({ key }: { key: string }) => {
    try {      const result = UiPayloadCache.peek(key)
      return { ok: true, result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Edits preview
  addMethod('edits.preview', async ({ key }: { key: string }) => {
    try {      const preview = UiPayloadCache.peek(key)
      return { ok: true, preview }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Session metrics - usage/costs are now stored in session items
  addMethod('session.getMetrics', async () => {
    try {
      // Metrics are now computed from session items, not stored separately
      // Return empty for now - renderer should compute from session.items
      return { ok: true, metrics: null }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('session.getUsageStrict', async () => {
    try {
      // Usage is now stored in session items (NodeExecutionBox.cost)
      // Return empty for now - renderer should compute from session.items
      return { ok: false, error: 'not-implemented' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('session.getUsage', async () => {
    try {
      // Usage is now stored in session items (NodeExecutionBox.cost)
      // Return empty for now - renderer should compute from session.items
      return { ok: true, usage: null }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Window ready signal - renderer has set up all listeners
  addMethod('window.ready', async (args: { windowId?: string } = {}) => {
    try {
      if (!args.windowId) {
        return { ok: false, error: 'windowId is required' }
      }

      const windowId = parseInt(args.windowId, 10)
      if (isNaN(windowId)) {
        return { ok: false, error: 'windowId must be a number' }
      }

      console.log('[window.ready] Renderer ready, windowId:', windowId)

      // Register window ID in connection metadata
      const existing = activeConnections.get(connection)
      activeConnections.set(connection, {
        windowId,
        hydrationPhase: existing?.hydrationPhase || 'connected',
        hydrationSince: existing?.hydrationSince || Date.now(),
        snapshotVersion: existing?.snapshotVersion || 0,
      })

      // Check if this window has a workspace attached (from persistence)
      const { getWorkspaceService } = await import('../../../services/index.js')
      const workspaceService = getWorkspaceService()
      const workspaceId = workspaceService.getWorkspaceForWindow(windowId)

      // If workspace exists for this window, load and stream it
      if (workspaceId) {
        console.log('[window.ready] Loading workspace:', workspaceId)
        const result = await loadWorkspace({
          workspaceId,
          connection,
          windowId: String(windowId),
          background: false  // Block until complete
        })

        return {
          ok: result.ok,
          workspaceId,
          bound: result.ok,
          error: result.error
        }
      }

      // No workspace for this window - renderer will show Welcome screen
      console.log('[window.ready] No workspace bound, showing Welcome screen')
      connection.sendNotification('loading.complete', {})
      return { ok: true, bound: false }
    } catch (e: any) {
      console.error('[window.ready] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('handshake.ping', async () => ({ pong: true }))

  // Flow tools
  addMethod('flows.getTools', async () => {
    try {
      // Tools are now registered globally, not in FlowConfigService
      // Return empty array for now - this RPC may need to be removed or reimplemented
      return { ok: true, tools: [] }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Flow execution handlers
  addMethod('flow.start', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound', code: 'no-workspace' }
      }

      const { getSessionService, getFlowGraphService } = await import('../../../services/index.js')
      const sessionService = getSessionService()
      const flowGraphService = getFlowGraphService()

      // Get current session
      const currentSessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (!currentSessionId) {
        return { ok: false, error: 'No current session', code: 'no-current-session' }
      }

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const session = sessions.find((s) => s.id === currentSessionId)
      if (!session) {
        return { ok: false, error: 'Session not found', code: 'session-not-found' }
      }

      // Get session context
      if (!session.currentContext) {
        return { ok: false, error: 'Session has no context', code: 'no-session-context' }
      }

      // Get flow definition from FlowGraphService (already loaded during workspace load)
      const graph = flowGraphService.getGraph({ workspaceId })
      console.log('[flow.start] Graph for workspace:', workspaceId, 'nodeCount:', graph.nodes?.length, 'edgeCount:', graph.edges?.length)

      if (!graph.nodes || graph.nodes.length === 0) {
        console.error('[flow.start] No flow loaded for workspace:', workspaceId)
        return { ok: false, error: 'No flow loaded', code: 'no-flow' }
      }

      // Convert ReactFlow edges to flow-engine edges
      const { reactFlowEdgesToFlowEdges } = await import('../../../services/flowConversion.js')
      const flowEdges = reactFlowEdgesToFlowEdges(graph.edges)

      // Generate request ID
      const crypto = await import('crypto')
      const requestId = crypto.randomUUID()

      // Get WebContents for this connection
      const { BrowserWindow } = await import('electron')
      const meta = activeConnections.get(connection)
      const wc = meta?.windowId ? BrowserWindow.fromId(meta.windowId)?.webContents : undefined

      // Execute flow
      const { executeFlow } = await import('../../../flow-engine/index.js')
      const result = await executeFlow(wc, {
        requestId,
        flowDef: { nodes: graph.nodes, edges: flowEdges },
        sessionId: currentSessionId,
        workspaceId,
        initialContext: {
          provider: session.currentContext.provider,
          model: session.currentContext.model,
          systemInstructions: session.currentContext.systemInstructions,
          messageHistory: session.currentContext.messageHistory || [],
        },
      })

      if (result.ok) {
        return { ok: true, requestId }
      } else {
        return { ok: false, error: result.error }
      }
    } catch (e: any) {
      console.error('[flow.start] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.resume', async ({ requestId, userInput }: { requestId?: string; userInput: string }) => {
    try {
      if (!requestId) {
        return { ok: false, error: 'requestId is required' }
      }

      const { BrowserWindow } = await import('electron')
      const meta = activeConnections.get(connection)
      const wc = meta?.windowId ? BrowserWindow.fromId(meta.windowId)?.webContents : undefined

      const { resumeFlow } = await import('../../../flow-engine/index.js')
      const result = await resumeFlow(wc, requestId, userInput)
      return result
    } catch (e: any) {
      console.error('[flow.resume] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.cancel', async ({ requestId }: { requestId?: string }) => {
    try {
      const { cancelFlow } = await import('../../../flow-engine/index.js')

      if (requestId) {
        // Cancel specific flow
        const result = await cancelFlow(requestId)
        return result
      } else {
        // Cancel all flows for this workspace
        const workspaceId = await getConnectionWorkspaceId(connection)
        if (!workspaceId) {
          return { ok: false, error: 'No workspace bound' }
        }

        const { getActiveFlows } = await import('../../../flow-engine/index.js')
        const activeFlows = getActiveFlows()

        // Cancel all flows for this workspace
        const results = await Promise.all(
          Array.from(activeFlows.keys()).map((rid) => cancelFlow(rid))
        )

        const allOk = results.every((r) => r.ok)
        return { ok: allOk }
      }
    } catch (e: any) {
      console.error('[flow.cancel] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.getActive', async () => {
    try {
      const { getActiveFlows } = await import('../../../flow-engine/index.js')
      const activeFlows = getActiveFlows()
      return Array.from(activeFlows.keys())
    } catch (e: any) {
      console.error('[flow.getActive] Error:', e)
      return []
    }
  })

  addMethod('flow.getStatus', async ({ requestId }: { requestId?: string }) => {
    try {
      if (!requestId) {
        return { ok: false, error: 'requestId is required' }
      }

      const { getFlowSnapshot } = await import('../../../flow-engine/index.js')
      const snapshot = getFlowSnapshot(requestId)

      if (!snapshot) {
        return { ok: false, error: 'Flow not found' }
      }

      return snapshot
    } catch (e: any) {
      console.error('[flow.getStatus] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })
}