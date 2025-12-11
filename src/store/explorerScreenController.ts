import { getBackendClient } from '@/lib/backend/bootstrap'
import { useExplorerHydration } from '@/store/screenHydration'
import { useExplorerStore } from '@/store/explorer'
import { useEditorStore } from '@/store/editor'
import { useTerminalTabs } from '@/store/terminalTabs'
import { useTerminalStore } from '@/store/terminal'
import { useWorkspaceSearchStore } from '@/store/workspaceSearch'

let controllerInitialized = false
let pendingLoad: Promise<void> | null = null
let pendingFitIds: Set<string> = new Set()
let fitFrame: number | null = null

async function runExplorerHydration(force: boolean): Promise<void> {
  if (pendingLoad) {
    return pendingLoad
  }

  const hydration = useExplorerHydration.getState()
  if (!force) {
    const phase = hydration.phase
    if (phase !== 'idle' && phase !== 'error') {
      return Promise.resolve()
    }
  }

  hydration.startLoading()

  const promise = (async () => {
    try {
      const client = getBackendClient()
      if (client && typeof (client as any).whenReady === 'function') {
        try {
          await (client as any).whenReady(5000)
        } catch {}
      }

      await Promise.all([
        useTerminalTabs.getState().hydrateTabs(),
        useExplorerStore.getState().hydrate(),
        useEditorStore.getState().hydrateFromPersistence(),
      ])
      hydration.setReady()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load explorer'
      hydration.setError(message)
      throw error
    } finally {
      pendingLoad = null
    }
  })()

  pendingLoad = promise
  return promise
}

function ensureExplorerHydration(): void {
  void runExplorerHydration(false)
}

function flushTerminalFits(): void {
  if (fitFrame !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(fitFrame)
    fitFrame = null
  }
  if (!pendingFitIds.size) return
  if (!useTerminalStore.getState().explorerTerminalPanelOpen) {
    pendingFitIds.clear()
    return
  }
  const fitTerminal = useTerminalStore.getState().fitTerminal
  const targets = Array.from(pendingFitIds)
  pendingFitIds.clear()
  targets.forEach((id) => {
    try {
      fitTerminal(id)
    } catch {}
  })
}

function enqueueTerminalFits(tabIds: string[]): void {
  if (!useTerminalStore.getState().explorerTerminalPanelOpen) return
  if (tabIds.length === 0) return
  tabIds.forEach((id) => pendingFitIds.add(id))
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    flushTerminalFits()
    return
  }
  if (fitFrame !== null) return
  fitFrame = window.requestAnimationFrame(() => {
    fitFrame = null
    flushTerminalFits()
  })
}

export function reloadExplorerScreen(): Promise<void> {
  return runExplorerHydration(true)
}

export function initExplorerScreenController(): void {
  if (controllerInitialized) return
  controllerInitialized = true

  ensureExplorerHydration()

  let lastPhase = useExplorerHydration.getState().phase
  useExplorerHydration.subscribe((state) => {
    if (state.phase === 'idle' && lastPhase !== 'idle') {
      ensureExplorerHydration()
    }
    lastPhase = state.phase
  })

  let lastActive = useTerminalTabs.getState().explorerActive
  let lastTabSignature = useTerminalTabs.getState().explorerTabs.map((tab) => tab.id).join('|')
  useTerminalTabs.subscribe((state) => {
    if (state.explorerActive !== lastActive) {
      lastActive = state.explorerActive
      if (lastActive) {
        enqueueTerminalFits([lastActive])
      }
    }

    const signature = state.explorerTabs.map((tab) => tab.id).join('|')
    if (signature !== lastTabSignature) {
      lastTabSignature = signature
      if (state.explorerTabs.length) {
        enqueueTerminalFits(state.explorerTabs.map((tab) => tab.id))
      }
    }
  })

  let lastPanelOpen = useTerminalStore.getState().explorerTerminalPanelOpen
  useTerminalStore.subscribe((state) => {
    const open = state.explorerTerminalPanelOpen
    if (open && !lastPanelOpen) {
      const tabs = useTerminalTabs.getState().explorerTabs
      if (tabs.length) {
        enqueueTerminalFits(tabs.map((tab) => tab.id))
      }
    }
    lastPanelOpen = open
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void useEditorStore.getState().saveActiveTab()
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        useWorkspaceSearchStore.getState().requestFocus('query')
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        useWorkspaceSearchStore.getState().requestFocus('replace')
      }
    })
  }
}

