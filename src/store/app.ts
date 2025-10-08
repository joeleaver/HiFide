import { create } from 'zustand'

export type ViewType = 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings'

export type AppState = {
  // View state
  currentView: ViewType
  setCurrentView: (view: ViewType) => void

  // Folder state
  selectedFolder: string | null
  setSelectedFolder: (folder: string | null) => void

  // Model/Provider state
  selectedModel: string
  setSelectedModel: (m: string) => void
  selectedProvider: string
  setSelectedProvider: (p: string) => void
  autoRetry: boolean
  setAutoRetry: (v: boolean) => void

  // Auto-approve policy (agent-initiated risky commands)
  autoApproveEnabled: boolean
  setAutoApproveEnabled: (v: boolean) => void
  autoApproveThreshold: number // 0..1
  setAutoApproveThreshold: (v: number) => void

  // Provider validation state (controls provider visibility in UI)
  providerValid: Record<string, boolean>
  setProviderValid: (provider: string, valid: boolean) => void
  setProvidersValid: (map: Record<string, boolean>) => void

  // Default models per provider
  defaultModels: Record<string, string>
  setDefaultModel: (provider: string, model: string) => void

  // Agent behavior settings
  autoEnforceEditsSchema: boolean
  setAutoEnforceEditsSchema: (v: boolean) => void

  // UI state
  metaPanelOpen: boolean
  setMetaPanelOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void

  // Terminal panel UI (per view)
  agentTerminalPanelOpen: boolean
  setAgentTerminalPanelOpen: (open: boolean) => void
  agentTerminalPanelHeight: number
  setAgentTerminalPanelHeight: (h: number) => void

  explorerTerminalPanelOpen: boolean
  setExplorerTerminalPanelOpen: (open: boolean) => void
  toggleExplorerTerminalPanel: () => void
  explorerTerminalPanelHeight: number
  setExplorerTerminalPanelHeight: (h: number) => void

  // Editor state
  openedFile: { path: string; content: string; language: string } | null
  setOpenedFile: (file: { path: string; content: string; language: string } | null) => void
}

const defaultModel = typeof localStorage !== 'undefined' && localStorage.getItem('hifide:model')
  ? localStorage.getItem('hifide:model')!
  : 'gpt-5'
const defaultProviderValid: Record<string, boolean> = { openai: false, anthropic: false, gemini: false }
const defaultDefaultModels: Record<string, string> = (() => {
  try {
    const j = typeof localStorage !== 'undefined' ? localStorage.getItem('hifide:defaultModels') : null


    return j ? JSON.parse(j) : { openai: 'gpt-5', anthropic: 'claude-3-5-sonnet', gemini: 'gemini-1.5-pro' }
  } catch {
    return { openai: 'gpt-5', anthropic: 'claude-3-5-sonnet', gemini: 'gemini-1.5-pro' }
  }
})()

const defaultProvider = typeof localStorage !== 'undefined' && localStorage.getItem('hifide:provider')
  ? localStorage.getItem('hifide:provider')!
  : 'openai'
const defaultView = (typeof localStorage !== 'undefined' && localStorage.getItem('hifide:view') as ViewType)
  || 'agent'
const defaultFolder = typeof localStorage !== 'undefined' && localStorage.getItem('hifide:folder')
  ? localStorage.getItem('hifide:folder')
  : null

const defaultAutoApproveEnabled = (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('hifide:autoApproveEnabled') === '1' } catch { return false } })()
const defaultAutoApproveThreshold = (() => { try { const v = typeof localStorage !== 'undefined' ? localStorage.getItem('hifide:autoApproveThreshold') : null; return v ? parseFloat(v) : 0.8 } catch { return 0.8 } })()
const defaultAutoEnforceEditsSchema = (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('hifide:autoEnforceEditsSchema') === '1' } catch { return false } })()

export const useAppStore = create<AppState>((set, get) => ({


  // View state
  currentView: defaultView,
  setCurrentView: (view) => {
    try { localStorage.setItem('hifide:view', view) } catch {}
    set({ currentView: view })
  },

  // Folder state
  selectedFolder: defaultFolder,
  setSelectedFolder: (folder) => {
    try {
      if (folder) localStorage.setItem('hifide:folder', folder)
      else localStorage.removeItem('hifide:folder')
    } catch {}
    set({ selectedFolder: folder })
  },

  // Model/Provider state
  selectedModel: defaultModel,
  setSelectedModel: (m) => {
    try { localStorage.setItem('hifide:model', m) } catch {}
    set({ selectedModel: m })
  },
  selectedProvider: defaultProvider,
  setSelectedProvider: (p) => {
    try { localStorage.setItem('hifide:provider', p) } catch {}
    set({ selectedProvider: p })
  },
  autoRetry: true,
  setAutoRetry: (v) => set({ autoRetry: v }),

  // Auto-approve policy
  autoApproveEnabled: defaultAutoApproveEnabled,
  setAutoApproveEnabled: (v) => {
    try { localStorage.setItem('hifide:autoApproveEnabled', v ? '1' : '0') } catch {}
    set({ autoApproveEnabled: v })
  },
  autoApproveThreshold: defaultAutoApproveThreshold,
  setAutoApproveThreshold: (v) => {
    const clamped = Math.max(0, Math.min(1, v))
    try { localStorage.setItem('hifide:autoApproveThreshold', String(clamped)) } catch {}
    set({ autoApproveThreshold: clamped })
  },

  // Provider validation state
  providerValid: defaultProviderValid,
  setProviderValid: (provider, valid) => set({ providerValid: { ...get().providerValid, [provider]: valid } }),
  setProvidersValid: (map) => set({ providerValid: { ...get().providerValid, ...map } }),

  // Default models per provider
  defaultModels: defaultDefaultModels,
  setDefaultModel: (provider, model) => {
    const next = { ...get().defaultModels, [provider]: model }
    try { localStorage.setItem('hifide:defaultModels', JSON.stringify(next)) } catch {}
    set({ defaultModels: next })
  },

  // Agent behavior settings
  autoEnforceEditsSchema: defaultAutoEnforceEditsSchema,
  setAutoEnforceEditsSchema: (v) => {
    try { localStorage.setItem('hifide:autoEnforceEditsSchema', v ? '1' : '0') } catch {}
    set({ autoEnforceEditsSchema: v })
  },

  // UI state
  metaPanelOpen: true,
  setMetaPanelOpen: (open) => set({ metaPanelOpen: open }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // Terminal panel UI (per view)
  agentTerminalPanelOpen: false,
  setAgentTerminalPanelOpen: (open) => set({ agentTerminalPanelOpen: open }),
  agentTerminalPanelHeight: 260,
  setAgentTerminalPanelHeight: (h) => set({ agentTerminalPanelHeight: h }),

  explorerTerminalPanelOpen: false,
  setExplorerTerminalPanelOpen: (open) => set({ explorerTerminalPanelOpen: open }),
  toggleExplorerTerminalPanel: () => set({ explorerTerminalPanelOpen: !get().explorerTerminalPanelOpen }),
  explorerTerminalPanelHeight: 260,
  setExplorerTerminalPanelHeight: (h) => set({ explorerTerminalPanelHeight: h }),

  // Editor state
  openedFile: null,
  setOpenedFile: (file) => set({ openedFile: file }),
}))

