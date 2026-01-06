import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useBackendBinding } from './binding'

export interface IndexingStatus {
  isProcessing: boolean
  currentTask: string | null
  queueLength: number
  indexedCount: number
  fileCount?: number
  chunkCount?: number
  workspaceId?: string
  // Detailed counts
  code?: {
    total: number
    indexed: number
    missing: number
  }
  kb?: {
    total: number
    indexed: number
    missing: number
  }
  memories?: {
    total: number
    indexed: number
    missing: number
  }
  // Overall indexing enabled state
  indexingEnabled?: boolean
}

interface IndexingStore {
  status: IndexingStatus | null
  error: string | null
  loading: boolean

  // Actions
  fetchStatus: () => Promise<void>
  subscribe: () => () => void
  hydrate: () => Promise<void>
  startIndexing: () => Promise<void>
  stopIndexing: () => Promise<void>
  reindex: (force?: boolean) => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
}

export const useIndexingStore = create<IndexingStore>((set, get) => ({
  status: null,
  error: null,
  loading: false,

  fetchStatus: async () => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true })
    try {
      const res = await client.rpc<any>('indexing.getStatus', {})
      if (res?.ok) {
        set({ status: res, error: null })
      } else {
        const msg = res?.error || 'Unknown error response'
        if (msg === 'reconnecting') {
          setTimeout(() => get().fetchStatus(), 1000)
        } else {
          set({ error: msg })
        }
      }
    } catch (err: any) {
      const msg = err.message || String(err)
      if (msg === 'reconnecting') {
        setTimeout(() => get().fetchStatus(), 1000)
      } else {
        set({ error: msg })
      }
    } finally {
      set({ loading: false })
    }
  },

  subscribe: () => {
    const client = getBackendClient()
    if (!client) return () => {}

    const unsubAttached = client.subscribe('workspace.attached', (p: any) => {
      const workspaceId = p?.workspaceId || p?.id || p?.root
      if (workspaceId) {
        get().fetchStatus().catch(() => {})
      }
    })

    const unsub = client.subscribe('indexing.status.changed', (s: any) => {
      // Check if this update is for our current workspace
      const currentWorkspaceId = useBackendBinding.getState().workspaceId
      if (s?.workspaceId && currentWorkspaceId && s.workspaceId !== currentWorkspaceId) {
        return
      }
      set({ status: s, error: null })
    })

    const handleConnect = () => get().fetchStatus()
    const anyClient = client as any
    anyClient.on?.('connect', handleConnect)

    return () => {
      unsub()
      unsubAttached()
      anyClient.off?.('connect', handleConnect)
    }
  },

  startIndexing: async () => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true, error: null })
    try {
      const res = await client.rpc<any>('indexing.start', {})
      if (!res?.ok) {
        set({ error: res?.error || 'Failed to start indexing' })
      }
    } catch (err: any) {
      set({ error: err.message || String(err) })
    } finally {
      set({ loading: false })
    }
  },

  stopIndexing: async () => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true, error: null })
    try {
      const res = await client.rpc<any>('indexing.stop', {})
      if (!res?.ok) {
        set({ error: res?.error || 'Failed to stop indexing' })
      }
    } catch (err: any) {
      set({ error: err.message || String(err) })
    } finally {
      set({ loading: false })
    }
  },

  reindex: async (force = false) => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true, error: null })
    try {
      const res = await client.rpc<any>('indexing.reindex', { force })
      if (!res?.ok) {
        set({ error: res?.error || 'Failed to re-index workspace' })
      }
    } catch (err: any) {
      set({ error: err.message || String(err) })
    } finally {
      set({ loading: false })
    }
  },

  setEnabled: async (enabled: boolean) => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true, error: null })
    try {
      const res = await client.rpc<any>('indexing.setEnabled', { enabled })
      if (res?.ok) {
        // Update local status with new enabled state
        set((state) => ({
          status: state.status ? { ...state.status, indexingEnabled: enabled } : null
        }))
      } else {
        set({ error: res?.error || 'Failed to update indexing enabled state' })
      }
    } catch (err: any) {
      set({ error: err.message || String(err) })
    } finally {
      set({ loading: false })
    }
  },

  hydrate: async () => {
    await get().fetchStatus()
  }
}))
