import { create } from 'zustand'
import { useBackendBinding } from './binding'
import type { BackendClient } from '../lib/backend/client'
import { FlowService, type FlowMcpServerSummary, type FlowToolDefinition } from '../services/flow'

export type ToolDefinition = FlowToolDefinition

type ToolsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface FlowToolsState {
  status: ToolsStatus
  tools: ToolDefinition[]
  mcpServers: FlowMcpServerSummary[]
  workspaceId: string | null
  error?: string
  hydrate: (options?: { force?: boolean; workspaceId?: string | null }) => Promise<void>
}

export const useFlowToolsStore = create<FlowToolsState>((set, get) => ({
  status: 'idle',
  tools: [],
  mcpServers: [],
  workspaceId: null,

  hydrate: async (options) => {
    const bindingWorkspace = useBackendBinding.getState().workspaceId
    const targetWorkspace = options?.workspaceId ?? bindingWorkspace

    if (!targetWorkspace) {
      set({ status: 'idle', tools: [], mcpServers: [], workspaceId: null })
      return
    }

    if (!options?.force) {
      const state = get()
      if (state.status === 'loading') return
      if (state.status === 'ready' && state.workspaceId === targetWorkspace) return
    }

    set({ status: 'loading', error: undefined })
    try {
      const { tools, mcpServers } = await FlowService.getTools()
      set({
        tools,
        mcpServers,
        status: 'ready',
        workspaceId: targetWorkspace,
        error: undefined,
      })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to load tools',
      })
    }
  },
}))

let flowToolsEventsInitialized = false

export function initFlowToolsEvents(client?: BackendClient | null): void {
  if (flowToolsEventsInitialized) return
  if (!client) return

  client.subscribe('flow.tools.changed', (payload: any) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const eventWorkspace = payload?.workspaceId ?? null
    if (eventWorkspace && eventWorkspace !== workspaceId) return
    void useFlowToolsStore.getState().hydrate({ force: true, workspaceId })
  })

  flowToolsEventsInitialized = true
}
