import { create } from 'zustand'
import type { RendererMenuStatePayload } from '../../shared/menu'
import { DEFAULT_RENDERER_MENU_STATE } from '../../shared/menu'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { useUiStore } from './ui'
import { useBackendBinding } from './binding'
import type { BackendBindingState } from './binding'
import { useEditorStore } from './editor'

interface ViewStateStore {
  snapshot: RendererMenuStatePayload
  snapshotJson: string
  lastPublishedJson: string
  publishTimer: ReturnType<typeof setTimeout> | null
  setSnapshot: (next: RendererMenuStatePayload) => void
  schedulePublish: () => void
  publishNow: () => Promise<void>
  forcePublishSoon: (opts?: { immediate?: boolean }) => void
}

function cloneMenuState(state: RendererMenuStatePayload = DEFAULT_RENDERER_MENU_STATE): RendererMenuStatePayload {
  return {
    ...state,
    fileActions: {
      ...state.fileActions,
    },
  }
}

const INITIAL_MENU_STATE = cloneMenuState()

export const useViewStateStore = create<ViewStateStore>((set, get) => ({
  snapshot: INITIAL_MENU_STATE,
  snapshotJson: JSON.stringify(INITIAL_MENU_STATE),
  lastPublishedJson: '',
  publishTimer: null,
  setSnapshot: (next) => {
    const json = JSON.stringify(next)
    if (json === get().snapshotJson) return
    set({ snapshot: next, snapshotJson: json })
    get().schedulePublish()
  },
  schedulePublish: () => {
    const existing = get().publishTimer
    if (existing) return
    const timer = setTimeout(() => {
      set({ publishTimer: null })
      void get().publishNow()
    }, 25)
    set({ publishTimer: timer })
  },
  publishNow: async () => {
    const client = getBackendClient()
    if (!client) return
    const { snapshotJson, lastPublishedJson, snapshot } = get()
    if (snapshotJson === lastPublishedJson) return
    try {
      await client.rpc('menu.updateState', { state: snapshot })
      set({ lastPublishedJson: snapshotJson })
    } catch (error) {
      console.warn('[viewState] Failed to push menu state', error)
    }
  },
  forcePublishSoon: (opts) => {
    set({ lastPublishedJson: '__force__' })
    if (opts?.immediate) {
      void get().publishNow()
    } else {
      get().schedulePublish()
    }
  },
}))

function buildMenuSnapshot(): RendererMenuStatePayload {
  const ui = useUiStore.getState()
  const binding = useBackendBinding.getState()
  const editor = useEditorStore.getState()

  const currentView = ui.currentView ?? 'flow'
  const workspaceReady = !!binding.attached && !!editor.workspaceRoot
  const activeTab = editor.activeTabId ? editor.tabs.find((tab) => tab.id === editor.activeTabId) : undefined
  const hasOpenTab = editor.tabs.length > 0
  const hasDirtyTab = editor.tabs.some((tab) => tab.isDirty)

  return {
    view: currentView,
    workspaceAttached: !!binding.attached,
    hasOpenTab,
    hasDirtyTab,
    windowId: binding.windowId,
    fileActions: {
      visible: currentView === 'explorer',
      canCreateFile: workspaceReady,
      canOpenFile: workspaceReady,
      canSave: !!activeTab,
      canSaveAs: !!activeTab,
    },
  }
}

let controllerInitialized = false
let unsubscribeFns: Array<() => void> = []

export function initViewStateController(): void {
  if (controllerInitialized) return
  controllerInitialized = true

  const recompute = () => {
    const snapshot = buildMenuSnapshot()
    useViewStateStore.getState().setSnapshot(cloneMenuState(snapshot))
  }

  const uiUnsub = useUiStore.subscribe((state, prev) => {
    if (state.currentView !== prev.currentView) {
      recompute()
    }
  })

  const bindingUnsub = useBackendBinding.subscribe((state: BackendBindingState, prev: BackendBindingState) => {
    if (state.attached !== prev.attached || state.windowId !== prev.windowId) {
      recompute()
    }
  })

  const editorUnsub = useEditorStore.subscribe((state, prev) => {
    if (
      state.activeTabId !== prev.activeTabId ||
      state.workspaceRoot !== prev.workspaceRoot ||
      state.tabs !== prev.tabs
    ) {
      recompute()
    }
  })

  unsubscribeFns = [uiUnsub, bindingUnsub, editorUnsub]
  recompute()

  if ((import.meta as any).hot) {
    (import.meta as any).hot.dispose(() => {
      unsubscribeFns.forEach((unsub) => {
        try { unsub() } catch {}
      })
      unsubscribeFns = []
      controllerInitialized = false
    })
  }
}

export function requestMenuStatePublish(options?: { immediate?: boolean }): void {
  useViewStateStore.getState().forcePublishSoon(options)
}
