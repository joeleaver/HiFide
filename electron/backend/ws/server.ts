import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { JSONRPCServer, JSONRPCServerAndClient, JSONRPCClient } from 'json-rpc-2.0'

import {
  activeConnections,
  unregisterConnection,
} from './broadcast.js'
import { setupEventSubscriptions } from './event-subscriptions.js'
import { flowEvents } from '../../flow-engine/events'
import { getWorkspaceIdForSessionId } from '../../utils/workspace-session'

// Extracted RPC handler modules
import {
  createSessionHandlers,
  createTerminalHandlers,
  createWorkspaceHandlers,
  createKbHandlers,
  createUiHandlers,
  createFlowEditorHandlers,
  createMiscHandlers,
  createSettingsHandlers,
  createKanbanHandlers,
  createMcpHandlers,
  createLanguageHandlers,
} from './handlers/index.js'
import { getWorkspaceService } from '../../services/index.js'

// Module-level state for WebSocket server
let httpServer: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
let bootstrap: WsBootstrap | null = null
let bootstrapReady: Promise<WsBootstrap> | null = null
let resolveBootstrap: ((value: WsBootstrap) => void) | null = null

function broadcastFlowEvent(ev: any): void {
  try {
    const sid = (ev && typeof ev === 'object') ? (ev.sessionId || null) : null
    //console.log('[broadcastFlowEvent] Event type:', ev.type, 'sessionId:', sid)
    const wsFromSid = getWorkspaceIdForSessionId(sid)
    //console.log('[broadcastFlowEvent] Workspace from sessionId:', wsFromSid)
    if (!wsFromSid) {
      console.error('[broadcastFlowEvent] Failed to find workspace for sessionId:', sid, 'event type:', ev.type)
      return
    }
    broadcastWorkspaceNotification(wsFromSid, 'flow.event', ev)
  } catch (e) {
    console.error('[broadcastFlowEvent] Error:', e)
  }
}

export interface WsBootstrap {
  url: string
  token: string
}

// Global flow.event forwarder: ensure renderers receive flow events regardless of when executeFlow was called
// We attach ONCE to the 'broadcast' channel and forward all events to the renderer
// This replaces the per-requestId listener pattern which was causing duplicate events
try {
  // Single global listener on the 'broadcast' channel - attached once at startup
  flowEvents.on('broadcast', (event: any) => {
    try {
      const sanitized = JSON.parse(JSON.stringify(event))
      broadcastFlowEvent(sanitized)
    } catch (error) {
      try {
        const reqId = (event && typeof event === 'object' ? (event.requestId || 'unknown') : 'unknown')
        broadcastFlowEvent({
          requestId: reqId,
          type: 'error',
          error: 'Failed to serialize flow event'
        })
      } catch { }
    }
  })
} catch { }



// RPC Connection interface
interface RpcConnection {
  sendNotification: (method: string, params: any) => void
}

// Workspace notification helper - now async to look up window→workspace mapping
async function broadcastWorkspaceNotification(workspaceId: string, method: string, params: any): Promise<void> {
  try {
    const workspaceService = getWorkspaceService()
    for (const [conn, meta] of activeConnections.entries()) {
      const connWorkspace = workspaceService.getWorkspaceForWindow(meta.windowId)
      if (connWorkspace === workspaceId) {
        try {
          conn.sendNotification(method, params)
        } catch { }
      }
    }
  } catch { }
}

export function startWsBackend(): Promise<WsBootstrap> {
  if (bootstrap && wss) return Promise.resolve(bootstrap)
  if (bootstrapReady) return bootstrapReady

  const token = randomBytes(16).toString('hex')

  httpServer = createServer()
  wss = new WebSocketServer({ server: httpServer, host: '127.0.0.1' })
  // Bind handlers (auth + services)
  wss.on('connection', (ws: WebSocket, req) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const authHeader = req.headers['authorization']
      const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader
      const queryToken = url.searchParams.get('token') || ''
      const supplied = (bearer && bearer.replace(/^Bearer\s+/i, '')) || queryToken
      if (supplied !== token) {
        ws.close(1008, 'Unauthorized')
        return
      }

      // Create JSON-RPC server that sends via WebSocket
      const rpcServer = new JSONRPCServerAndClient(
        new JSONRPCServer(),
        new JSONRPCClient((request) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(request))
          }
        })
      )

      // Create connection wrapper that implements RpcConnection interface
      const connection: RpcConnection = {
        sendNotification: (method: string, params: any) => {
          try {
            if (
              method.startsWith('workspace.') ||
              method.startsWith('session.') ||
              method.startsWith('flow.')
            ) {
              // const meta = activeConnections.get(connection)
              // const workspaceService = getWorkspaceService()
              // const workspace = meta?.windowId ? workspaceService.getWorkspaceForWindow(meta.windowId) : null
              // console.log('[ws-main] send', method, {
              //   toWindow: meta?.windowId || null,
              //   workspaceId: workspace || null,
              // })
            }
          } catch { }
          // Send as notification (no response expected)
          rpcServer.notify(method, params)
        }
      }

      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString())
          const response = await rpcServer.receiveAndSend(message)
          if (response !== undefined && response !== null) {
            ws.send(JSON.stringify(response))
          }
        } catch (e) {
          console.error('[ws-main] Failed to process message:', e, 'data:', data.toString())
        }
      })

      // Helper to add RPC methods with logging
      const addMethod = (method: string, handler: (params: any) => any) => {
        rpcServer.addMethod(method, async (params: any) => {
          try {
            if (
              method.startsWith('handshake.') ||
              method.startsWith('workspace.') ||
              method.startsWith('session.') ||
              method.startsWith('flow.')
            ) {
              const meta = activeConnections.get(connection)
              const workspaceService = getWorkspaceService()
              const workspace = meta?.windowId ? workspaceService.getWorkspaceForWindow(meta.windowId) : null
              console.log('[ws-main] rpc', method, {
                windowId: meta?.windowId || null,
                workspaceId: workspace || null,
                params: params ?? null,
              })
            }
          } catch { }
          return handler(params)
        })
      }

      // Connection will be registered by handshake.init handler with windowId
      // All RPC handlers now registered via handler modules below
      // Removed duplicate inline handlers for:
      // - workspace.get (now in workspace-handlers.ts)
      // - view.get/set (now in ui-handlers.ts)
      // - explorer.getState (now in ui-handlers.ts)
      // - explorer.toggleFolder (DEAD CODE - never called)
      // - editor.openFile (DEAD CODE - never called)
      // - session.getMetrics (DEAD CODE - always returned null)
      // - session.getUsage/getUsageStrict (now in service-handlers.ts)


      // All inline handlers moved to handler modules

      // Register all RPC handlers
      // Note: handshake.init is now in misc-handlers.ts (consolidated with other misc handlers)
      createSessionHandlers(addMethod, connection)
      createTerminalHandlers(addMethod, connection)
      createWorkspaceHandlers(addMethod, connection)
      createKbHandlers(addMethod, connection)
      createUiHandlers(addMethod, connection)
      createFlowEditorHandlers(addMethod, connection)
      createMiscHandlers(addMethod, connection)
      createSettingsHandlers(addMethod)
      createKanbanHandlers(addMethod)
      createMcpHandlers(addMethod)
      createLanguageHandlers(addMethod, connection)

      // Setup all event subscriptions for this connection
      const cleanupSubscriptions = setupEventSubscriptions(connection)

      // Connection registration happens in handshake.init handler (with windowId)
      // Setup cleanup on close
      ws.on('close', () => {
        unregisterConnection(connection)
        cleanupSubscriptions()
      })

      // No need to call listen() with json-rpc-2.0 - messages are handled via ws.on('message')
    } catch (err) {
      console.error('[ws-main] Connection setup error:', err)
      try { ws.close(1011, 'Internal error') } catch { }
    }
  })

  bootstrapReady = new Promise<WsBootstrap>((resolve) => { resolveBootstrap = resolve })

  // Listen on ephemeral port and resolve when bound


  httpServer.listen(0, '127.0.0.1', () => {
    try {
      const address = httpServer!.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const url = `ws://127.0.0.1:${port}`
      bootstrap = { url, token }
      resolveBootstrap?.(bootstrap)
    } catch { }
  })

  return bootstrapReady!
}



export function getWsBackendBootstrap(): WsBootstrap | null {
  return bootstrap
}

export function stopWsBackend(): void {
  try { wss?.clients.forEach((c) => c.close()) } catch { }
  try { wss?.close() } catch { }
  try { httpServer?.close() } catch { }
  wss = null
  httpServer = null
  bootstrap = null
}

