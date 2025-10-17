/**
 * Indexing Slice
 * 
 * Manages code indexing and semantic search.
 * 
 * Responsibilities:
 * - Track index status (ready, chunks, model)
 * - Manage index building/rebuilding
 * - Handle search queries and results
 * - Subscribe to index progress updates
 * - Clear index when needed
 * 
 * Dependencies:
 * - Workspace slice (for workspace root)
 */

import type { StateCreator } from 'zustand'
import type { IndexStatus, IndexProgress } from '../types'

// ============================================================================
// Types
// ============================================================================

export type IndexSearchResult = {
  path: string
  startLine: number
  endLine: number
  text: string
}

export interface IndexingSlice {
  // State
  idxStatus: IndexStatus | null
  idxLoading: boolean
  idxQuery: string
  idxResults: IndexSearchResult[]
  idxProg: IndexProgress | null
  
  // Actions
  ensureIndexProgressSubscription: () => void
  refreshIndexStatus: () => Promise<void>
  rebuildIndex: () => Promise<{ ok: boolean; status?: IndexStatus | null; error?: unknown } | undefined>
  clearIndex: () => Promise<{ ok: boolean } | undefined>
  setIdxQuery: (q: string) => void
  searchIndex: () => Promise<void>
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createIndexingSlice: StateCreator<IndexingSlice, [], [], IndexingSlice> = (set, get) => ({
  // State
  idxStatus: null,
  idxLoading: false,
  idxQuery: '',
  idxResults: [],
  idxProg: null,
  
  // Actions
  ensureIndexProgressSubscription: (() => {
    let subscribed = false
    
    return () => {
      if (subscribed) return
      subscribed = true
      
      // Subscribe to index progress updates from main process
      if (typeof window !== 'undefined' && window.ipcRenderer?.on) {
        const handler = (_: any, prog: IndexProgress) => {
          set({ idxProg: prog })
          
          // If indexing is complete, refresh status
          if (prog && !prog.inProgress) {
            const state = get() as any
            if (state.refreshIndexStatus) {
              state.refreshIndexStatus().catch((e: any) => {
                console.error('[indexing] Failed to refresh status after completion:', e)
              })
            }
          }
        }
        
        try {
          window.ipcRenderer.on('index:progress', handler)
        } catch (e) {
          console.error('[indexing] Failed to subscribe to index progress:', e)
        }
      }
    }
  })(),
  
  refreshIndexStatus: async () => {
    // Only run in renderer process
    if (typeof window === 'undefined' || !window.indexing) {
      return
    }

    try {
      const res = await window.indexing.status()

      if (res?.ok) {
        set({ idxStatus: res.status || null })
      } else {
      }
    } catch (e) {
      console.error('[indexing] Failed to refresh status:', e)
    }
  },
  
  rebuildIndex: async () => {
    // Only run in renderer process
    if (typeof window === 'undefined' || !window.indexing) {
      return { ok: false, error: 'Not in renderer process' }
    }

    set({ idxLoading: true })

    try {
      const res = await window.indexing.rebuild()

      if (res?.ok) {
        set({ idxStatus: res.status || null })
      } else {
      }

      return res
    } catch (e) {
      console.error('[indexing] Index rebuild error:', e)
      return { ok: false, error: e }
    } finally {
      set({ idxLoading: false })
    }
  },
  
  clearIndex: async () => {
    // Only run in renderer process
    if (typeof window === 'undefined' || !window.indexing) {
      return { ok: false }
    }


    try {
      const res = await window.indexing.clear()

      if (res?.ok) {
        const state = get()
        const currentStatus = state.idxStatus

        // Update status to reflect cleared index
        if (currentStatus) {
          set({
            idxStatus: {
              ...currentStatus,
              ready: false,
              chunks: 0,
            },
          })
        }

      } else {
      }

      return res
    } catch (e) {
      console.error('[indexing] Failed to clear index:', e)
      return { ok: false }
    }
  },
  
  setIdxQuery: (q: string) => {
    set({ idxQuery: q })
  },
  
  searchIndex: async () => {
    // Only run in renderer process
    if (typeof window === 'undefined' || !window.indexing) {
      return
    }

    const state = get()
    const query = state.idxQuery.trim()

    if (!query) {
      set({ idxResults: [] })
      return
    }


    try {
      // Search with limit of 20 results
      const res = await window.indexing.search(query, 20)


      if (res?.ok) {
        const results = res.chunks || []
        set({ idxResults: results })
      } else {
        set({ idxResults: [] })
      }
    } catch (e) {
      console.error('[indexing] Search error:', e)
      set({ idxResults: [] })
    }
  },
})

