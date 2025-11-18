import { getBackendClient } from '../lib/backend/bootstrap'

// Local listener registries
const dataListeners = new Set<(payload: { sessionId: string; data: string }) => void>()
const exitListeners = new Set<(payload: { sessionId: string; exitCode: number }) => void>()
let subscribed = false
let subscribeRetryTimer: any = null

function scheduleSubscribeRetry() {
  if (subscribeRetryTimer) return
  subscribeRetryTimer = setTimeout(() => {
    subscribeRetryTimer = null
    ensureSubscribed()
  }, 150)
}

function ensureSubscribed() {
  if (subscribed) return
  const client = getBackendClient()
  if (!client) { scheduleSubscribeRetry(); return }
  // Wait until the JSON-RPC connection is ready before subscribing
  const anyClient = client as any
  if (!anyClient.isReady || !anyClient.isReady()) { scheduleSubscribeRetry(); return }

  try {
    client.subscribe('terminal.data', (payload: { sessionId: string; data: string }) => {
      for (const fn of Array.from(dataListeners)) {
        try { fn(payload) } catch {}
      }
    })
    client.subscribe('terminal.exit', (payload: { sessionId: string; exitCode: number }) => {
      for (const fn of Array.from(exitListeners)) {
        try { fn(payload) } catch {}
      }
    })
    subscribed = true
  } catch {
    scheduleSubscribeRetry()
  }
}

export async function create(opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean }) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  const res = await client.rpc<{ sessionId: string }>('terminal.create', opts || {})
  return res
}

export async function write(sessionId: string, data: string) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  return await client.rpc('terminal.write', { sessionId, data })
}

export async function resize(sessionId: string, cols: number, rows: number) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  try {
    const res = await client.rpc<{ ok: boolean }>('terminal.resize', { sessionId, cols, rows })
    if (res && (res as any).ok) return res
  } catch {}
  // Fallback for agent PTYs
  try {
    return await client.rpc<{ ok: boolean }>('agent-pty.resize', { sessionId, cols, rows })
  } catch {
    return { ok: false }
  }
}

export async function dispose(sessionId: string) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  return await client.rpc('terminal.dispose', { sessionId })
}

export function onData(listener: (payload: { sessionId: string; data: string }) => void) {
  ensureSubscribed()
  dataListeners.add(listener)
  return () => { dataListeners.delete(listener) }
}

export function onExit(listener: (payload: { sessionId: string; exitCode: number }) => void) {
  ensureSubscribed()
  exitListeners.add(listener)
  return () => { exitListeners.delete(listener) }
}

export async function attachAgent(opts?: { requestId?: string; sessionId?: string; tailBytes?: number }) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  return await client.rpc('agent-pty.attach', opts || {})
}

export async function detachAgent(sessionId: string) {
  const client = getBackendClient()
  if (!client) throw new Error('backend-not-connected')
  const anyClient = client as any
  if (anyClient.whenReady) { await anyClient.whenReady(5000) }
  return await client.rpc('agent-pty.detach', { sessionId })
}
