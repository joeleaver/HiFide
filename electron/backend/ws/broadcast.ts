import path from 'path'
import type { HydrationPhase } from '../../../shared/hydration.js'

export interface RpcConnection {
  sendNotification(method: string, params: any): void
}

export interface ConnectionMeta {
  workspaceId?: string
  windowId?: string
  selectedSessionId?: string
  // Hydration state machine (all optional with defaults applied in registerConnection)
  hydrationPhase?: HydrationPhase
  hydrationSince?: number  // Timestamp when current phase started
  snapshotVersion?: number // Monotonic version for delta ordering
}

// Active JSON-RPC connections with metadata
export const activeConnections = new Map<RpcConnection, ConnectionMeta>()

export function registerConnection(connection: RpcConnection, meta: Partial<ConnectionMeta> = {}): void {
  const now = Date.now()
  const existing = activeConnections.get(connection)
  activeConnections.set(connection, {
    hydrationPhase: 'connected',
    hydrationSince: now,
    snapshotVersion: 0,
    ...existing,
    ...meta,
  })
}

/**
 * Transition a connection's hydration phase.
 * Returns true if the transition was valid, false otherwise.
 */
export function transitionConnectionPhase(
  connection: RpcConnection,
  newPhase: HydrationPhase,
  notify = true
): boolean {
  const meta = activeConnections.get(connection)
  if (!meta) return false

  const oldPhase = meta.hydrationPhase
  // Allow any transition for now (validation can be added later)
  meta.hydrationPhase = newPhase
  meta.hydrationSince = Date.now()

  console.log(`[hydration] Connection phase: ${oldPhase} → ${newPhase}`)

  // Notify the renderer of phase change
  if (notify) {
    try {
      connection.sendNotification('hydration.phase', {
        phase: newPhase,
        since: meta.hydrationSince,
      })
    } catch {}
  }

  return true
}

/**
 * Get the current hydration phase for a connection
 */
export function getConnectionPhase(connection: RpcConnection): HydrationPhase {
  return activeConnections.get(connection)?.hydrationPhase ?? 'disconnected'
}

/**
 * Increment and return the snapshot version for a connection
 */
export function incrementSnapshotVersion(connection: RpcConnection): number {
  const meta = activeConnections.get(connection)
  if (!meta) return 0
  if (meta.snapshotVersion === undefined) meta.snapshotVersion = 0
  meta.snapshotVersion++
  return meta.snapshotVersion
}

/**
 * Get the current snapshot version for a connection
 */
export function getSnapshotVersion(connection: RpcConnection): number {
  return activeConnections.get(connection)?.snapshotVersion || 0
}

export function unregisterConnection(connection: RpcConnection): void {
  activeConnections.delete(connection)
}

export function setConnectionWorkspace(connection: RpcConnection, workspaceId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, workspaceId: workspaceId || undefined })
}

export function setConnectionWindowId(connection: RpcConnection, windowId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, windowId: windowId || undefined })
}

export function getConnectionWorkspaceId(connection: RpcConnection): string | undefined {
  const meta = activeConnections.get(connection)
  return meta?.workspaceId
}

export function setConnectionSelectedSessionId(connection: RpcConnection, sessionId?: string | null): void {
  const existing = activeConnections.get(connection) || {}
  activeConnections.set(connection, { ...existing, selectedSessionId: sessionId || undefined })
}

export function getConnectionSelectedSessionId(connection: RpcConnection): string | undefined {
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
  let sentCount = 0
  let totalConnections = 0
  const resolvedTarget = path.resolve(workspaceId)

  for (const [conn, meta] of Array.from(activeConnections.entries())) {
    totalConnections++
    const connWs = meta.workspaceId || null
    const matches = sameWorkspaceId(connWs, workspaceId)

    if (matches) {
      try {
        conn.sendNotification(method, params)
        sentCount++
      } catch (e) {
        // Swallow broadcast failures; individual connections may have closed
        console.warn(`[broadcast] Failed to send ${method} to connection:`, e)
      }
    }
  }
  if (sentCount === 0 && totalConnections > 0) {
    const connWorkspaces = Array.from(activeConnections.values()).map(m => {
      const ws = m.workspaceId
      return ws ? `${ws} (resolved: ${path.resolve(ws)})` : 'null'
    })
    console.warn(`[broadcast] No connections matched workspace ${workspaceId} (resolved: ${resolvedTarget}) for ${method}. Total connections: ${totalConnections}, connection workspaces:`, connWorkspaces)
  } else if (sentCount > 0) {
    console.log(`[broadcast] Sent ${method} to ${sentCount}/${totalConnections} connections for workspace ${workspaceId}`)
  }
}
