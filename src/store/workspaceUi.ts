import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useUiStore } from './ui'

interface WorkspaceUiState {
  root: string | null
  __setRoot: (root: string | null) => void
}

function createWorkspaceUiStore() {
  return create<WorkspaceUiState>((set) => ({
    root: null,
    __setRoot: (root) => set({ root }),
  }))
}

// HMR reuse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __workspaceUiStore: any = hotData.workspaceUiStore || createWorkspaceUiStore()
export const useWorkspaceUi = __workspaceUiStore
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => { data.workspaceUiStore = __workspaceUiStore })
}

let inited = false
export function initWorkspaceUiEvents(): void {
  if (inited) return
  const client = getBackendClient()
  if (!client) return // Do not mark inited until a live client exists; bootstrap will call again on open
  inited = true

  try {
    client.subscribe('workspace.bound', async (p: any) => {
      try { useWorkspaceUi.getState().__setRoot(p?.root || null) } catch {}
      try { useUiStore.getState().setCurrentViewLocal('flow') } catch {}
      try { await client.rpc('view.set', { view: 'flow' }) } catch {}
    })
    client.subscribe('workspace.ready', async (p: any) => {
      try { useWorkspaceUi.getState().__setRoot(p?.root || null) } catch {}
      try { useUiStore.getState().setCurrentViewLocal('flow') } catch {}
      try { await client.rpc('view.set', { view: 'flow' }) } catch {}
    })
    client.subscribe('workspace.error', (_p: any) => {
      // keep previous root; optionally show welcome view
      try { if (!useWorkspaceUi.getState().root) useUiStore.getState().setCurrentViewLocal('welcome') } catch {}
    })
    // Handshake auto-bind path: no workspace.* events are emitted. Use session events as a signal to re-hydrate root.
    const rehydrateIfUnbound = async () => {
      try {
        const st = useWorkspaceUi.getState()
        if (st.root) return
        const ws = await client.rpc('workspace.get', {})
        if (ws?.ok && ws.root) {
          st.__setRoot(ws.root)
          try { useUiStore.getState().setCurrentViewLocal('flow') } catch {}
          try { await client.rpc('view.set', { view: 'flow' }) } catch {}
        }
      } catch {}
    }
    client.subscribe('session.list.changed', async () => { await rehydrateIfUnbound() })
    client.subscribe('session.selected', async () => { await rehydrateIfUnbound() })
  } catch {}

  ;(async () => {
    try { await (client as any).whenReady?.(5000) } catch {}
    const tryHydrate = async (attempt = 0): Promise<void> => {
      try {
        const ws = await client.rpc('workspace.get', {})
        if (ws?.ok) {
          const root = ws.root || null
          useWorkspaceUi.getState().__setRoot(root)
          if (root) {
            try { useUiStore.getState().setCurrentViewLocal('flow') } catch {}
            try { await client.rpc('view.set', { view: 'flow' }) } catch {}
            return
          } else {
            // Avoid forcing Welcome here; handshake may bind shortly after connect.
            // Fall through to retry.
          }
        }
      } catch {}
      if (attempt < 3) {
        setTimeout(() => { void tryHydrate(attempt + 1) }, attempt === 0 ? 350 : attempt === 1 ? 700 : 1200)
      } else {
        // After retries, if still no root and UI is undefined, show Welcome
        try { if (!useWorkspaceUi.getState().root) useUiStore.getState().setCurrentViewLocal('welcome') } catch {}
      }
    }
    void tryHydrate(0)
  })()
}

