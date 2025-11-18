import type { MessageConnection } from 'vscode-jsonrpc'
import path from 'path'

export interface ConnectionMeta {
  workspaceId?: string
  windowId?: string
  selectedSessionId?: string
}

// Active JSON-RPC connections with metadata
export const activeConnections = new Map<MessageConnection, ConnectionMeta>()

export function registerConnection(connection: MessageConnection, meta: Partial<ConnectionMeta> = {}): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, ...meta })
}

export function unregisterConnection(connection: MessageConnection): void {
  activeConnections.delete(connection)
}

export function setConnectionWorkspace(connection: MessageConnection, workspaceId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, workspaceId: workspaceId || undefined })
}

export function setConnectionWindowId(connection: MessageConnection, windowId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, windowId: windowId || undefined })
}

export function getConnectionWorkspaceId(connection: MessageConnection): string | undefined {
  const meta = activeConnections.get(connection)
  return meta?.workspaceId
}

export function setConnectionSelectedSessionId(connection: MessageConnection, sessionId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, selectedSessionId: sessionId || undefined })
}

export function getConnectionSelectedSessionId(connection: MessageConnection): string | undefined {
  const meta = activeConnections.get(connection)
  return meta?.selectedSessionId
}

// Broadcast to all connections
export function broadcastWsNotification(method: string, params: any): void {
  for (const [conn] of Array.from(activeConnections.entries())) {
    try { conn.sendNotification(method, params) } catch {}
  }
}

// Broadcast only to connections bound to a specific workspace
function sameWorkspaceId(a?: string | null, b?: string | null): boolean {
  try { return !!a && !!b && path.resolve(String(a)) === path.resolve(String(b)) } catch { return a === b }
}

export function broadcastWorkspaceNotification(workspaceId: string, method: string, params: any): void {
  for (const [conn, meta] of Array.from(activeConnections.entries())) {
    if (sameWorkspaceId(meta.workspaceId || null, workspaceId)) {
      try {
        conn.sendNotification(method, params)
      } catch (e) {
        // Swallow broadcast failures; individual connections may have closed
      }
    }
  }
}
