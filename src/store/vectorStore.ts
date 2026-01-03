import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

export interface VectorStatus {
  indexing: boolean
  progress: number
  totalFiles: number
  indexedFiles: number
}

export interface VectorState {
  initialized: boolean
  indexing: boolean
  lastIndexedAt: string | null
  status: VectorStatus
}

export interface VectorSearchResult {
  id: string
  text: string
  score: number
  type: 'code' | 'kb' | 'memory'
  filePath?: string
  symbolName?: string
  symbolType?: string
  articleTitle?: string
  metadata?: any
}

interface VectorStore {
  state: VectorState | null
  error: string | null
  searching: boolean
  results: VectorSearchResult[]
  searchQuery: string
  searchTarget: 'all' | 'code' | 'kb'

  // Actions
  fetchState: () => Promise<void>
  subscribe: () => () => void
  setSearchQuery: (query: string) => void
  setSearchTarget: (target: 'all' | 'code' | 'kb') => void
  search: () => Promise<void>
  startIndexing: () => Promise<void>
}

export const useVectorStore = create<VectorStore>((set, get) => ({
  state: null,
  error: null,
  searching: false,
  results: [],
  searchQuery: '',
  searchTarget: 'all',

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchTarget: (target) => set({ searchTarget: target }),

  fetchState: async () => {
    const client = getBackendClient()
    if (!client) return

    try {
      const res = await client.rpc<any>('vector.getState', {})
      if (res?.ok) {
        set({ state: res.state, error: null })
      } else {
        const msg = res?.error || 'Unknown error response'
        if (msg === 'reconnecting') {
          setTimeout(() => get().fetchState(), 1000)
        } else {
          set({ error: msg })
        }
      }
    } catch (err: any) {
      const msg = err.message || String(err)
      if (msg === 'reconnecting') {
        setTimeout(() => get().fetchState(), 1000)
      } else {
        set({ error: msg })
      }
    }
  },

  subscribe: () => {
    const client = getBackendClient()
    if (!client) return () => {}

    const unsub = client.subscribe('vector_service.changed', (s: any) => {
      set({ state: s })
    })

    const handleConnect = () => get().fetchState()
    const anyClient = client as any
    anyClient.on?.('connect', handleConnect)

    return () => {
      unsub()
      anyClient.off?.('connect', handleConnect)
    }
  },

  search: async () => {
    const { searchQuery, searchTarget, searching } = get()
    const client = getBackendClient()
    if (!client || !searchQuery.trim() || searching) return

    set({ searching: true })
    try {
      const type = searchTarget === 'all' ? undefined : (searchTarget as any)
      const res = await client.rpc<any>('vector.search', {
        query: searchQuery,
        options: { limit: 20, type }
      })
      if (res?.ok) {
        set({ results: res.results || [] })
      } else {
        set({ error: res?.error || 'Search failed' })
      }
    } catch (err: any) {
      set({ error: err.message || String(err) })
    } finally {
      set({ searching: false })
    }
  },

  startIndexing: async () => {
    const client = getBackendClient()
    if (!client) return
    
    // Pass force: true to ensure we bypass hashes and actually re-index
    await client.rpc('codeIndexer.indexWorkspace', { force: true })
    await client.rpc('kbIndexer.indexWorkspace', { force: true })
  }
}))
