/* JSON-RPC client using json-rpc-2.0 over WebSocket */
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0'

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
  private rpcClient: JSONRPCServerAndClient | null = null
  private opts: BackendClientOptions
  private readyResolve: (() => void) | null = null
  private readyPromise: Promise<void>

  // Persisted method-specific subscriptions across reconnects
  private methodSubs: Array<{ method: string; handler: (params: any) => void }> = []

  constructor(opts: BackendClientOptions) {
    this.opts = opts
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })
  }

  /** Returns true when the JSON-RPC connection is established */
  isReady(): boolean {
    return !!this.rpcClient && !!this.ws && this.ws.readyState === WebSocket.OPEN
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
        // Create JSON-RPC server and client
        const rpcServer = new JSONRPCServer()
        const rpcClient = new JSONRPCClient((request) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(request))
          }
        })
        const rpcServerAndClient = new JSONRPCServerAndClient(rpcServer, rpcClient)

        this.rpcClient = rpcServerAndClient

        // Re-attach all subscriptions
        console.log(`[BackendClient] Re-attaching ${this.methodSubs.length} subscriptions`)
        const handlersByMethod = new Map<string, Array<(params: any) => void>>()
        for (const sub of this.methodSubs) {
          if (!handlersByMethod.has(sub.method)) {
            handlersByMethod.set(sub.method, [])
          }
          handlersByMethod.get(sub.method)!.push(sub.handler)
        }

        // Register handlers for each method
        for (const [method, handlers] of handlersByMethod.entries()) {
          console.log(`[BackendClient] Attaching ${handlers.length} handler(s) for '${method}'`)
          rpcServerAndClient.addMethod(method, (params: any) => {
            try { this.opts.onNotify?.(method, params) } catch {}
            for (const handler of handlers) {
              try {
                handler(params)
              } catch (e) {
                console.error(`[BackendClient] Handler error for '${method}':`, e)
              }
            }
          })
        }

        console.log('[BackendClient] JSON-RPC client ready')

        // Resolve readiness exactly once
        try { this.readyResolve?.() } catch {}
        this.retryDelayMs = 250
        this.opts.onOpen?.()
      } catch (err) {
        console.error('[BackendClient] Failed to initialize RPC client:', err)
        this.scheduleReconnect()
      }
    }

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        const response = await this.rpcClient?.receiveAndSend(message)
        if (response && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response))
        }
      } catch (e) {
        console.error('[BackendClient] Failed to process message:', e, 'data:', event.data)
      }
    }

    ws.onclose = (ev) => {
      console.log('[BackendClient] WebSocket closed:', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean })
      this.opts.onClose?.(ev)
      this.rpcClient = null
      // Create a fresh promise for potential future reconnects
      this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve })
      if (!this.intentionalClose) {
        console.log('[BackendClient] Scheduling reconnect...')
        this.scheduleReconnect()
      }
    }

    ws.onerror = (ev) => {
      console.error('[BackendClient] WebSocket error:', ev)
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
    const client = this.rpcClient
    if (!client) return Promise.reject({ code: -32000, message: 'WebSocket not open' })
    return client.request(method, params) as Promise<T>
  }

  /** Persistent subscription that survives reconnects. Returns an unsubscribe function. */
  subscribe(method: string, handler: (params: any) => void): () => void {
    const entry = { method, handler }
    this.methodSubs.push(entry)

    // If already connected, re-register all handlers for this method
    if (this.rpcClient) {
      const handlersForMethod = this.methodSubs.filter(s => s.method === method).map(s => s.handler)
      // Remove old handler and add new combined handler
      this.rpcClient.rejectAllPendingRequests('reconnecting')
      this.rpcClient.addMethod(method, (params: any) => {
        try { this.opts.onNotify?.(method, params) } catch {}
        for (const h of handlersForMethod) {
          try {
            h(params)
          } catch (e) {
            console.error(`[BackendClient] Handler error for '${method}':`, e)
          }
        }
      })
    }

    // Return unsubscribe function
    return () => {
      const idx = this.methodSubs.indexOf(entry)
      if (idx >= 0) this.methodSubs.splice(idx, 1)
    }
  }

  close(): void {
    this.intentionalClose = true
    try { this.ws?.close() } catch {}
    this.rpcClient = null
    this.ws = null
    // Reset readiness promise
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve })
  }
}

