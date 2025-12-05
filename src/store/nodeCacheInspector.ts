import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

export interface NodeCacheSnapshot {
  data: any
  timestamp: number
}

type CacheStatus = 'idle' | 'loading' | 'ready' | 'error'

interface NodeCacheState {
  snapshots: Record<string, NodeCacheSnapshot | undefined>
  status: Record<string, CacheStatus>
  errors: Record<string, string | undefined>
  fetchSnapshot: (nodeId: string) => Promise<void>
  invalidateCache: (nodeId: string) => Promise<void>
}

export const useNodeCacheStore = create<NodeCacheState>((set, get) => ({
  snapshots: {},
  status: {},
  errors: {},

  fetchSnapshot: async (nodeId) => {
    const current = get().status[nodeId]
    if (current === 'loading' || current === 'ready') return

    set((state) => ({
      status: { ...state.status, [nodeId]: 'loading' },
      errors: { ...state.errors, [nodeId]: undefined },
    }))

    const client = getBackendClient()
    if (!client) {
      set((state) => ({
        status: { ...state.status, [nodeId]: 'error' },
        errors: { ...state.errors, [nodeId]: 'backend-unavailable' },
      }))
      return
    }

    try {
      const res: any = await client.rpc('flow.getNodeCache', { nodeId })
      if (res?.ok) {
        set((state) => ({
          snapshots: { ...state.snapshots, [nodeId]: res.cache },
          status: { ...state.status, [nodeId]: 'ready' },
        }))
      } else {
        set((state) => ({
          status: { ...state.status, [nodeId]: 'error' },
          errors: { ...state.errors, [nodeId]: res?.error || 'Unknown error' },
        }))
      }
    } catch (err) {
      set((state) => ({
        status: { ...state.status, [nodeId]: 'error' },
        errors: { ...state.errors, [nodeId]: err instanceof Error ? err.message : 'Failed to load cache' },
      }))
    }
  },

  invalidateCache: async (nodeId) => {
    const client = getBackendClient()
    if (client) {
      try {
        await client.rpc('flow.clearNodeCache', { nodeId })
      } catch (err) {
        set((state) => ({
          errors: { ...state.errors, [nodeId]: err instanceof Error ? err.message : 'Failed to clear cache' },
        }))
      }
    }

    set((state) => ({
      snapshots: { ...state.snapshots, [nodeId]: undefined },
      status: { ...state.status, [nodeId]: 'idle' },
    }))
  }
}))
