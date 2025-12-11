
import { create } from 'zustand'
import { notifications } from '@mantine/notifications'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { useKanbanHydration } from './screenHydration'
import { useBackendBinding } from './binding'

// Re-export shared types for convenience
export type { KanbanBoard, KanbanTask, KanbanEpic, KanbanStatus } from '../../electron/store/types'
import type { KanbanBoard, KanbanTask, KanbanEpic, KanbanStatus } from '../../electron/store/types'

type TasksByStatus = Record<KanbanStatus, KanbanTask[]>

const createEmptyTasksByStatus = (): TasksByStatus => ({
  backlog: [],
  todo: [],
  inProgress: [],
  done: [],
})

const markKanbanScreenReady = () => {
  const hydration = useKanbanHydration.getState()

  if (hydration.phase === 'idle') {
    hydration.startLoading()
  }

  const updatedPhase = useKanbanHydration.getState().phase
  if (updatedPhase === 'loading' || updatedPhase === 'refreshing') {
    useKanbanHydration.getState().setReady()
  }
}

interface KanbanStore {
  board: KanbanBoard | null
  loading: boolean
  saving: boolean
  error: string | null

  // Derived state getters
  tasksByStatus: TasksByStatus
  epicMap: Map<string, KanbanEpic>

  setBoard: (board: KanbanBoard | null) => void
  setLoading: (loading: boolean) => void
  setSaving: (saving: boolean) => void
  setError: (error: string | null) => void
  hydrateBoard: () => Promise<void>

  // Derived state updater
  updateDerivedState: () => void
}

export const useKanban = create<KanbanStore>((set, get) => ({
  board: null,
  loading: false,
  saving: false,
  error: null,

  // Derived state
  tasksByStatus: createEmptyTasksByStatus(),
  epicMap: new Map<string, KanbanEpic>(),

  setBoard: (board) => {
    set({ board })
    get().updateDerivedState()
    markKanbanScreenReady()
  },
  setLoading: (loading) => set({ loading }),
  setSaving: (saving) => set({ saving }),
  setError: (error) => {
    const prevError = get().error
    set({ error })
    if (error && error !== prevError) {
      notifications.show({ color: 'red', title: 'Kanban error', message: error })
    }
  },

  hydrateBoard: async () => {
    const client = getBackendClient()
    if (!client) return
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) {
      console.warn('[kanban] hydrateBoard skipped - no workspace bound')
      return
    }

    try {
      const res: any = await client.rpc('kanban.getBoard', { workspaceId })
      if (res?.ok) {
        set({
          board: res.board || null,
          loading: !!res.loading,
          saving: !!res.saving,
          error: res.error || null,
        })
        get().updateDerivedState()
        markKanbanScreenReady()
      } else if (res?.error) {
        get().setError(res.error)
      }
    } catch (err) {
      console.error('[kanban] hydrateBoard failed:', err)
      get().setError('Failed to load Kanban board')
    }
  },

  updateDerivedState: () => {
    const board = get().board
    if (!board) {
      set({ tasksByStatus: createEmptyTasksByStatus(), epicMap: new Map() })
      return
    }

    // Group tasks by status
    const grouped: TasksByStatus = createEmptyTasksByStatus()

    // Filter out archived tasks and group by status
    for (const task of board.tasks) {
      if (!task.archived) {
        grouped[task.status].push(task)
      }
    }

    // Sort each group by order
    grouped.backlog.sort((a, b) => a.order - b.order)
    grouped.todo.sort((a, b) => a.order - b.order)
    grouped.inProgress.sort((a, b) => a.order - b.order)
    grouped.done.sort((a, b) => a.order - b.order)

    // Build epic map
    const epicMap = new Map<string, KanbanEpic>()
    for (const epic of board.epics) {
      epicMap.set(epic.id, epic)
    }

    set({ tasksByStatus: grouped, epicMap })
  },
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

