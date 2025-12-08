import { create } from 'zustand'
import type { BackendClient } from '../lib/backend/client'
import { FlowService } from '../services/flow'

export interface ToolDefinition {
  name: string
  description: string
  category?: string
}

type ToolsStatus = 'idle' | 'loading' | 'ready' | 'error'

interface FlowToolsState {
  status: ToolsStatus
  tools: ToolDefinition[]
  error?: string
  hydrate: (options?: { force?: boolean }) => Promise<void>
}

export const useFlowToolsStore = create<FlowToolsState>((set, get) => ({
  status: 'idle',
  tools: [],

  hydrate: async (options) => {
    const status = get().status
    if (!options?.force && (status === 'loading' || status === 'ready')) return

    set({ status: 'loading', error: undefined })
    try {
      const tools = await FlowService.getTools()
      set({ tools, status: 'ready', error: undefined })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to load tools'
      })
    }
  }
}))

let flowToolsEventsInitialized = false

export function initFlowToolsEvents(client?: BackendClient | null): void {
  if (flowToolsEventsInitialized) return
  if (!client) return

  client.subscribe('flow.tools.changed', () => {
    void useFlowToolsStore.getState().hydrate({ force: true })
  })

  flowToolsEventsInitialized = true
}
