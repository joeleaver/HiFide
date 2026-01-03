import { getBackendClient } from '../lib/backend/bootstrap'
import type { FlowExecutionArgs } from '@/../../electron/flow-engine/types'

export interface FlowToolDefinition {
  name: string
  description: string
  category?: string
  displayName?: string
  pluginId?: string
  pluginLabel?: string
}

export interface FlowMcpToolSummary {
  name: string
  description?: string | null
  fullName: string
}

export interface FlowMcpServerSummary {
  id: string
  slug: string
  label: string
  workspaceId: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  enabled: boolean
  autoStart: boolean
  toolCount: number
  tools: FlowMcpToolSummary[]
}

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

  async resume(
    requestId: string | undefined,
    userInput: string,
    options?: { userInputContext?: unknown }
  ): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.resume', {
      requestId,
      userInput,
      ...(options?.userInputContext !== undefined ? { userInputContext: options.userInputContext } : {})
    })
  },

  async cancel(requestId?: string): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.cancel', { requestId })
  },

  async stop(requestId?: string): Promise<{ ok: boolean; error?: string }> {
    const client = getBackendClient()
    if (!client) return { ok: false, error: 'backend-not-ready' }
    try { await client.whenReady?.(5000) } catch {}
    return client.rpc('flow.stop', { requestId })
  },

  async getTools(): Promise<{ tools: FlowToolDefinition[]; mcpServers: FlowMcpServerSummary[] }> {
    const client = getBackendClient()
    if (!client) return { tools: [], mcpServers: [] }
    try { await client.whenReady?.(5000) } catch {}
    const result = await client.rpc('flows.getTools', {})
    const tools = Array.isArray(result?.tools) ? result.tools : []
    const mcpServers = Array.isArray(result?.mcpServers) ? result.mcpServers : []
    return { tools, mcpServers }
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

