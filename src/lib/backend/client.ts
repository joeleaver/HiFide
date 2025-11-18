/* JSON-RPC client using vscode-jsonrpc over WebSocket */
import { createMessageConnection, MessageConnection, Disposable } from 'vscode-jsonrpc'
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from 'vscode-ws-jsonrpc'

export interface BackendClientOptions {
  url: string
  token?: string
  onOpen?: () => void
  onClose?: (ev: CloseEvent) => void
  onError?: (ev: Event) => void
  onNotify?: (method: string, params: any) => void
}

export class BackendClient {
  private ws: WebSocket | null = null
  private conn: MessageConnection | null = null
  private opts: BackendClientOptions
  private readyResolve: (() => void) | null = null
  private readyPromise: Promise<void>

  // Persisted method-specific subscriptions across reconnects
  private methodSubs: Array<{ method: string; handler: (params: any) => void; disp?: Disposable }> = []

  constructor(opts: BackendClientOptions) {
    this.opts = opts
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })
  }

  /** Returns true when the JSON-RPC connection is established */
  isReady(): boolean {
    return !!this.conn
  }

  /** Resolves when the JSON-RPC connection is established (or immediately if already ready). */
  async whenReady(timeoutMs: number = 5000): Promise<void> {
    if (this.isReady()) return
    const p = this.readyPromise
    if (!timeoutMs) return p
    let to: any
    await Promise.race([
      p,
      new Promise<void>((_, rej) => { to = setTimeout(() => rej(new Error('ws-backend-timeout')), timeoutMs) })
    ]).finally(() => { if (to) clearTimeout(to) })
  }

  private reconnectTimer: any = null
  private intentionalClose = false
  private retryDelayMs = 250

  connect(): void {
    // Prevent duplicate connections
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return
    }
    this.intentionalClose = false
    this.openSocket()
  }

  private openSocket(): void {
    const url = new URL(this.opts.url)
    if (this.opts.token) url.searchParams.set('token', this.opts.token)
    const ws = new WebSocket(url.toString())
    this.ws = ws

    ws.onopen = () => {
      try {
        const socket = toSocket(ws as any)
        const reader = new WebSocketMessageReader(socket)
        const writer = new WebSocketMessageWriter(socket)
        const conn = createMessageConnection(reader, writer)

        // Wrap method-specific subscriptions so we can forward every received
        // notification to the generic onNotify hook before per-method handlers.
        const origOnNotification = conn.onNotification.bind(conn)
        ;(conn as any).onNotification = (methodOrType: any, handler?: any) => {
          if (typeof methodOrType === 'string' && typeof handler === 'function') {
            const method = methodOrType
            const wrapped = (params: any) => {
              try { this.opts.onNotify?.(method, params) } catch {}
              try { handler(params) } catch {}
            }
            return origOnNotification(method, wrapped as any)
          }
          return origOnNotification(methodOrType as any, handler as any)
        }

        conn.listen()
        this.conn = conn

        // Re-attach method-specific subscriptions on this new connection
        for (const sub of this.methodSubs) {
          try { sub.disp = conn.onNotification(sub.method, sub.handler as any) } catch {}
        }

        // Resolve readiness exactly once
        try { this.readyResolve?.() } catch {}
        this.retryDelayMs = 250
        this.opts.onOpen?.()
      } catch (err) {
        this.scheduleReconnect()
      }
    }

    ws.onclose = (ev) => {
      this.opts.onClose?.(ev)
      try { this.conn?.dispose() } catch {}
      this.conn = null
      // Drop disposables; keep entries so we can re-attach on reconnect
      for (const sub of this.methodSubs) { sub.disp = undefined }
      // Create a fresh promise for potential future reconnects
      this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve })
      if (!this.intentionalClose) this.scheduleReconnect()
    }

    ws.onerror = (ev) => {
      this.opts.onError?.(ev)
      // If error occurs before open, schedule reconnect
      if (!this.intentionalClose && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return
    if (this.reconnectTimer) return
    const delay = this.retryDelayMs
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 2000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  rpc<T = any>(method: string, params?: any): Promise<T> {
    const conn = this.conn
    if (!conn) return Promise.reject({ code: -32000, message: 'WebSocket not open' })
    return conn.sendRequest(method, params) as Promise<T>
  }

  /** Persistent subscription that survives reconnects. Returns an unsubscribe function. */
  subscribe(method: string, handler: (params: any) => void): () => void {
    // Add to registry if not already present (allow duplicates of same method with different handlers)
    const entry = { method, handler, disp: undefined as undefined | Disposable }
    this.methodSubs.push(entry)
    // Attach immediately if connected
    if (this.conn) {
      try { entry.disp = this.conn.onNotification(method, handler as any) } catch {}
    }
    // Unsubscribe removes from registry and detaches current connection listener
    return () => {
      const idx = this.methodSubs.indexOf(entry)
      if (idx >= 0) this.methodSubs.splice(idx, 1)
      try { entry.disp?.dispose() } catch {}
      entry.disp = undefined
    }
  }

  close(): void {
    try { this.conn?.dispose() } catch {}
    try { this.ws?.close() } catch {}
    this.conn = null
    this.ws = null
    // Reset readiness promise
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve })
  }
}

