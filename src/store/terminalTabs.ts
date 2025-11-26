import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

interface TerminalTabsStore {
  agentTabs: any[]
  agentActive: string | null
  explorerTabs: any[]
  explorerActive: string | null
  
  setAgentTabs: (tabs: any[], active: string | null) => void
  setExplorerTabs: (tabs: any[], active: string | null) => void
  hydrateTabs: () => Promise<void>
}

export const useTerminalTabs = create<TerminalTabsStore>((set) => ({
  agentTabs: [],
  agentActive: null,
  explorerTabs: [],
  explorerActive: null,
  
  setAgentTabs: (tabs, active) => set({ agentTabs: tabs, agentActive: active }),
  setExplorerTabs: (tabs, active) => set({ explorerTabs: tabs, explorerActive: active }),
  
  hydrateTabs: async () => {
    const client = getBackendClient()
    if (!client) return
    
    try {
      const res: any = await client.rpc('terminal.getTabs', {})
      if (res?.ok) {
        set({
          agentTabs: Array.isArray(res.agentTabs) ? res.agentTabs : [],
          agentActive: res.agentActive || null,
          explorerTabs: Array.isArray(res.explorerTabs) ? res.explorerTabs : [],
          explorerActive: res.explorerActive || null
        })
      }
    } catch {}
  }
}))

export function initTerminalTabsEvents(): void {
  const client = getBackendClient()
  if (!client) return

  // Terminal tabs changed
  client.subscribe('terminal.tabs.changed', (p: any) => {
    useTerminalTabs.setState({
      agentTabs: Array.isArray(p?.agentTabs) ? p.agentTabs : [],
      agentActive: p?.agentActive || null,
      explorerTabs: Array.isArray(p?.explorerTabs) ? p.explorerTabs : [],
      explorerActive: p?.explorerActive || null
    })
  })

  // Workspace changes - rehydrate tabs
  // Only rehydrate on workspace.bound (actual workspace change), not workspace.ready (just a ready signal)
  client.subscribe('workspace.bound', () => {
    useTerminalTabs.getState().hydrateTabs()
  })
}

