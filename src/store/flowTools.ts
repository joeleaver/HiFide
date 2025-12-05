import { create } from 'zustand'
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
  hydrate: () => Promise<void>
}

export const useFlowToolsStore = create<FlowToolsState>((set, get) => ({
  status: 'idle',
  tools: [],

  hydrate: async () => {
    const status = get().status
    if (status === 'loading' || status === 'ready') return

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
