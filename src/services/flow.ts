import { getBackendClient } from '../lib/backend/bootstrap'
import type { FlowExecutionArgs } from '@/../../electron/ipc/flows-v2/types'

export type FlowEvent = {
  requestId: string
  sessionId?: string
  type: string
  [key: string]: any
}

export const FlowService = {
  async start(args?: Partial<FlowExecutionArgs>): Promise<{ ok: boolean; error?: string; requestId?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try {
      await client.whenReady?.(5000)
    } catch {}
    return client.rpc('flow.start', args || {})
  },

  async resume(requestId: string | undefined, userInput: string): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.resume', { requestId, userInput })
  },

  async cancel(requestId?: string): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.cancel', { requestId })
  },

  async getTools(): Promise<Array<{ name: string; description: string; category?: string }>> {
    const client = getBackendClient()
    if (!client) return []
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flows.getTools', {})
  },

  async getActive(): Promise<string[]> {
    const client = getBackendClient()
    if (!client) return []
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.getActive', {})
  },


  async getStatus(requestId?: string): Promise<
    | { requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }
    | Array<{ requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }>
  > {
    const client = getBackendClient()
    if (!client) return requestId ? { requestId, status: 'stopped', activeNodeIds: [], pausedNodeId: null } : []
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.status', { requestId })
  },

  onEvent(handler: (ev: FlowEvent) => void): () => void {
    const client = getBackendClient()
    if (!client) return () => {}
    return client.subscribe('flow.event', handler)
  },

  async newContext(): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('session.newContext', {})
  }
}

