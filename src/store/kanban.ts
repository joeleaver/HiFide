import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

// Re-export shared types for convenience
export type { KanbanBoard, KanbanTask, KanbanEpic, KanbanStatus } from '../../electron/store/types'
import type { KanbanBoard } from '../../electron/store/types'

interface KanbanStore {
  board: KanbanBoard | null
  loading: boolean
  saving: boolean
  error: string | null
  
  setBoard: (board: KanbanBoard | null) => void
  setLoading: (loading: boolean) => void
  setSaving: (saving: boolean) => void
  setError: (error: string | null) => void
  hydrateBoard: () => Promise<void>
}

export const useKanban = create<KanbanStore>((set) => ({
  board: null,
  loading: false,
  saving: false,
  error: null,
  
  setBoard: (board) => set({ board }),
  setLoading: (loading) => set({ loading }),
  setSaving: (saving) => set({ saving }),
  setError: (error) => set({ error }),
  
  hydrateBoard: async () => {
    const client = getBackendClient()
    if (!client) return
    
    try {
      const res: any = await client.rpc('kanban.getBoard', {})
      if (res?.ok) {
        set({
          board: res.board || null,
          loading: !!res.loading,
          saving: !!res.saving,
          error: res.error || null
        })
      }
    } catch {}
  }
}))

export function initKanbanEvents(): void {
  const client = getBackendClient()
  if (!client) return

  // Board changed - always update loading/saving/error, but board update is conditional
  client.subscribe('kanban.board.changed', (p: any) => {
    const state = useKanban.getState()

    // Always update status flags
    state.setLoading(!!p?.loading)
    state.setSaving(!!p?.saving)
    state.setError(p?.error || null)

    // Update board (components can override via setBoard for optimistic updates)
    if (p?.board !== undefined) {
      state.setBoard(p.board)
    }
  })
}

