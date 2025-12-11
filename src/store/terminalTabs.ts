import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { loadTerminalState, saveTerminalState, type TerminalPersistedState, type TerminalPersistedTab } from './utils/terminalPersistence'

export type TerminalContext = 'explorer' | 'agent'

export interface TerminalTabModel {
  id: string
  title: string
  cwd?: string
  shell?: string
  lastCommand?: string
  lastDimensions?: { cols: number; rows: number }
  createdAt: number
  updatedAt: number
}

interface TerminalTabsStore {
  explorerTabs: TerminalTabModel[]
  explorerActive: string | null
  agentTabs: TerminalTabModel[]
  agentActive: string | null
  nextExplorerSequence: number
  nextAgentSequence: number
  hydrateTabs: () => Promise<void>
  addExplorerTab: (opts?: Partial<TerminalTabModel>) => string
  closeExplorerTab: (tabId: string) => void
  setExplorerActive: (tabId: string) => void
  renameExplorerTab: (tabId: string, title: string) => void
  duplicateExplorerTab: (tabId: string) => string | null
  updateExplorerMetadata: (tabId: string, patch: TerminalMetadataPatch) => void
}

export type TerminalMetadataPatch = Partial<Pick<TerminalTabModel, 'cwd' | 'shell' | 'lastCommand' | 'lastDimensions'>>

const TITLE_PREFIX = 'Terminal'

const sanitizeString = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const sanitizeDimensions = (value?: { cols?: number; rows?: number } | null) => {
  if (!value) return undefined
  const cols = typeof value.cols === 'number' ? Math.round(value.cols) : NaN
  const rows = typeof value.rows === 'number' ? Math.round(value.rows) : NaN
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return undefined
  if (cols <= 0 || rows <= 0) return undefined
  return { cols, rows }
}

const generateTabId = (context: TerminalContext): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${context}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const persistState = (state: TerminalTabsStore) => {
  const payload: TerminalPersistedState = {
    explorer: {
      tabs: state.explorerTabs,
      activeId: state.explorerActive,
      counter: state.nextExplorerSequence,
    },
    agent: {
      tabs: state.agentTabs,
      activeId: state.agentActive,
      counter: state.nextAgentSequence,
    },
  }
  saveTerminalState(payload)
}

const toModel = (tab: TerminalPersistedTab): TerminalTabModel => ({
  id: tab.id,
  title: tab.title,
  cwd: tab.cwd,
  shell: tab.shell,
  lastCommand: tab.lastCommand,
  lastDimensions: tab.lastDimensions,
  createdAt: tab.createdAt,
  updatedAt: tab.updatedAt,
})

export const useTerminalTabs = create<TerminalTabsStore>((set, get) => ({
  explorerTabs: [],
  explorerActive: null,
  agentTabs: [],
  agentActive: null,
  nextExplorerSequence: 0,
  nextAgentSequence: 0,

  hydrateTabs: async () => {
    const persisted = loadTerminalState()
    set({
      explorerTabs: persisted.explorer.tabs.map(toModel),
      explorerActive: persisted.explorer.activeId || persisted.explorer.tabs[0]?.id || null,
      agentTabs: persisted.agent.tabs.map(toModel),
      agentActive: persisted.agent.activeId || persisted.agent.tabs[0]?.id || null,
      nextExplorerSequence: Math.max(persisted.explorer.counter, persisted.explorer.tabs.length),
      nextAgentSequence: Math.max(persisted.agent.counter, persisted.agent.tabs.length),
    })

    if (persisted.explorer.tabs.length === 0) {
      get().addExplorerTab()
    }
  },

  addExplorerTab: (opts) => {
    const id = generateTabId('explorer')
    const nextIndex = get().nextExplorerSequence + 1
    const now = Date.now()
    const title = sanitizeString(opts?.title) || `${TITLE_PREFIX} ${nextIndex}`
    const tab: TerminalTabModel = {
      id,
      title,
      cwd: sanitizeString(opts?.cwd),
      shell: sanitizeString(opts?.shell),
      lastCommand: sanitizeString(opts?.lastCommand),
      lastDimensions: sanitizeDimensions(opts?.lastDimensions),
      createdAt: now,
      updatedAt: now,
    }

    set((state) => ({
      explorerTabs: [...state.explorerTabs, tab],
      explorerActive: id,
      nextExplorerSequence: nextIndex,
    }))
    persistState(get())
    return id
  },

  closeExplorerTab: (tabId) => {
    set((state) => {
      const idx = state.explorerTabs.findIndex((tab) => tab.id === tabId)
      if (idx === -1) return state
      const nextTabs = state.explorerTabs.filter((tab) => tab.id !== tabId)
      let nextActive = state.explorerActive
      if (state.explorerActive === tabId) {
        if (nextTabs.length === 0) {
          nextActive = null
        } else {
          const fallbackIndex = Math.min(idx, nextTabs.length - 1)
          nextActive = nextTabs[fallbackIndex].id
        }
      }
      return { ...state, explorerTabs: nextTabs, explorerActive: nextActive }
    })
    persistState(get())
    if (get().explorerTabs.length === 0) {
      get().addExplorerTab()
    }
  },

  setExplorerActive: (tabId) => {
    if (!tabId) return
    set((state) => ({
      explorerActive: state.explorerTabs.some((tab) => tab.id === tabId) ? tabId : state.explorerActive,
    }))
    persistState(get())
  },

  renameExplorerTab: (tabId, title) => {
    set((state) => {
      const trimmed = sanitizeString(title) || undefined
      if (!trimmed) return state
      return {
        ...state,
        explorerTabs: state.explorerTabs.map((tab) => (tab.id === tabId ? { ...tab, title: trimmed, updatedAt: Date.now() } : tab)),
      }
    })
    persistState(get())
  },

  duplicateExplorerTab: (tabId) => {
    const target = get().explorerTabs.find((tab) => tab.id === tabId)
    if (!target) return null
    const nextIndex = get().nextExplorerSequence + 1
    const now = Date.now()
    const clone: TerminalTabModel = {
      ...target,
      id: generateTabId('explorer'),
      title: `${target.title} copy`,
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      explorerTabs: [...state.explorerTabs, clone],
      explorerActive: clone.id,
      nextExplorerSequence: nextIndex,
    }))
    persistState(get())
    return clone.id
  },

  updateExplorerMetadata: (tabId, patch) => {
    const sanitizedPatch: TerminalMetadataPatch = {
      cwd: sanitizeString(patch.cwd ?? null),
      shell: sanitizeString(patch.shell ?? null),
      lastCommand: sanitizeString(patch.lastCommand ?? null),
      lastDimensions: sanitizeDimensions(patch.lastDimensions ?? undefined),
    }
    set((state) => ({
      ...state,
      explorerTabs: state.explorerTabs.map((tab) => (tab.id === tabId
        ? {
            ...tab,
            ...sanitizedPatch,
            lastDimensions: sanitizedPatch.lastDimensions ?? tab.lastDimensions,
            updatedAt: Date.now(),
          }
        : tab)),
    }))
    persistState(get())
  },
}))

let terminalEventsInitialized = false
export function initTerminalTabsEvents(): void {
  if (terminalEventsInitialized) return
  const client = getBackendClient()
  if (!client) return
  terminalEventsInitialized = true

  client.subscribe('workspace.attached', () => {
    useTerminalTabs.getState().hydrateTabs().catch((error) => {
      console.error('[terminalTabs] Failed to hydrate after workspace attach', error)
    })
  })
}
