import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'
import type {
  CreateMcpServerInput,
  McpServerSnapshot,
  McpTestResult,
  UpdateMcpServerInput,
} from '../../shared/mcp'

interface McpServersStore {
  servers: McpServerSnapshot[]
  loading: boolean
  creating: boolean
  error: string | null
  mutatingIds: Record<string, boolean>
  testingIds: Record<string, boolean>

  setServers: (servers: McpServerSnapshot[]) => void
  hydrateServers: () => Promise<void>
  createServer: (input: CreateMcpServerInput) => Promise<McpServerSnapshot>
  updateServer: (serverId: string, patch: UpdateMcpServerInput) => Promise<McpServerSnapshot>
  deleteServer: (serverId: string) => Promise<void>
  refreshServer: (serverId: string) => Promise<McpServerSnapshot>
  toggleServer: (serverId: string, enabled: boolean) => Promise<McpServerSnapshot>
  testServer: (params: { server?: CreateMcpServerInput; serverId?: string }) => Promise<McpTestResult>
}

const sortServers = (servers: McpServerSnapshot[]): McpServerSnapshot[] =>
  [...servers].sort((a, b) => a.label.localeCompare(b.label))

const upsertServer = (servers: McpServerSnapshot[], server: McpServerSnapshot): McpServerSnapshot[] => {
  const filtered = servers.filter((s) => s.id !== server.id)
  return sortServers([...filtered, server])
}

const removeServer = (servers: McpServerSnapshot[], serverId: string): McpServerSnapshot[] =>
  servers.filter((s) => s.id !== serverId)

const requireClient = () => {
  const client = getBackendClient()
  if (!client) {
    throw new Error('Backend connection is not ready yet')
  }
  return client
}

export const useMcpServers = create<McpServersStore>((set) => ({
  servers: [],
  loading: false,
  creating: false,
  error: null,
  mutatingIds: {},
  testingIds: {},

  setServers: (servers) => {
    const next = Array.isArray(servers) ? sortServers(servers) : []
    set({ servers: next, error: null })
  },

  hydrateServers: async () => {
    const client = requireClient()
    set({ loading: true })
    try {
      const res: any = await client.rpc('mcp.listServers', {})
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to load MCP servers')
      }
      const servers: McpServerSnapshot[] = Array.isArray(res.servers) ? res.servers : []
      set({ servers: sortServers(servers), error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  createServer: async (input) => {
    const client = requireClient()
    set({ creating: true })
    try {
      const res: any = await client.rpc('mcp.createServer', { server: input })
      if (!res?.ok || !res.server) {
        throw new Error(res?.error || 'Failed to create MCP server')
      }
      set((state) => ({ servers: upsertServer(state.servers, res.server) }))
      return res.server as McpServerSnapshot
    } catch (err) {
      throw err
    } finally {
      set({ creating: false })
    }
  },

  updateServer: async (serverId, patch) => {
    const client = requireClient()
    set((state) => ({ mutatingIds: { ...state.mutatingIds, [serverId]: true } }))
    try {
      const res: any = await client.rpc('mcp.updateServer', { id: serverId, patch })
      if (!res?.ok || !res.server) {
        throw new Error(res?.error || 'Failed to update MCP server')
      }
      set((state) => ({ servers: upsertServer(state.servers, res.server) }))
      return res.server as McpServerSnapshot
    } finally {
      set((state) => {
        const next = { ...state.mutatingIds }
        delete next[serverId]
        return { mutatingIds: next }
      })
    }
  },

  deleteServer: async (serverId) => {
    const client = requireClient()
    set((state) => ({ mutatingIds: { ...state.mutatingIds, [serverId]: true } }))
    try {
      const res: any = await client.rpc('mcp.deleteServer', { id: serverId })
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to delete MCP server')
      }
      set((state) => ({ servers: removeServer(state.servers, serverId) }))
    } finally {
      set((state) => {
        const next = { ...state.mutatingIds }
        delete next[serverId]
        return { mutatingIds: next }
      })
    }
  },

  refreshServer: async (serverId) => {
    const client = requireClient()
    set((state) => ({ mutatingIds: { ...state.mutatingIds, [serverId]: true } }))
    try {
      const res: any = await client.rpc('mcp.refreshServer', { id: serverId })
      if (!res?.ok || !res.server) {
        throw new Error(res?.error || 'Failed to refresh MCP server')
      }
      set((state) => ({ servers: upsertServer(state.servers, res.server) }))
      return res.server as McpServerSnapshot
    } finally {
      set((state) => {
        const next = { ...state.mutatingIds }
        delete next[serverId]
        return { mutatingIds: next }
      })
    }
  },

  toggleServer: async (serverId, enabled) => {
    const client = requireClient()
    set((state) => ({ mutatingIds: { ...state.mutatingIds, [serverId]: true } }))
    try {
      const res: any = await client.rpc('mcp.toggleServer', { id: serverId, enabled })
      if (!res?.ok || !res.server) {
        throw new Error(res?.error || 'Failed to update server state')
      }
      set((state) => ({ servers: upsertServer(state.servers, res.server) }))
      return res.server as McpServerSnapshot
    } finally {
      set((state) => {
        const next = { ...state.mutatingIds }
        delete next[serverId]
        return { mutatingIds: next }
      })
    }
  },

  testServer: async (params) => {
    const key = params.serverId ?? '__draft__'
    const client = requireClient()
    set((state) => ({ testingIds: { ...state.testingIds, [key]: true } }))
    try {
      const res: McpTestResult = await client.rpc('mcp.testServer', params)
      return res
    } finally {
      set((state) => {
        const next = { ...state.testingIds }
        delete next[key]
        return { testingIds: next }
      })
    }
  },
}))

let eventsInitialized = false

export function initMcpEvents(): void {
  if (eventsInitialized) return
  const client = getBackendClient()
  if (!client) return

  client.subscribe('mcp.servers.changed', (payload: any) => {
    try {
      const servers: McpServerSnapshot[] = Array.isArray(payload?.servers) ? payload.servers : []
      useMcpServers.getState().setServers(servers)
    } catch (error) {
      console.warn('[mcp] Failed to process servers snapshot', error)
    }
  })

  eventsInitialized = true
}
