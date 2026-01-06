
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

  // Actions
  moveTask: (taskId: string, toStatus: KanbanStatus, toIndex: number) => Promise<void>
  createTask: (input: any) => Promise<void>
  updateTask: (taskId: string, patch: any) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  createEpic: (input: any) => Promise<void>
  updateEpic: (epicId: string, patch: any) => Promise<void>
  deleteEpic: (epicId: string) => Promise<void>
  archiveTasks: (olderThan: number) => Promise<void>
  logWorkOnTask: (taskId: string, message: string) => Promise<void>
  getTask: (taskId: string) => Promise<KanbanTask | null>

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

  moveTask: async (taskId, toStatus, toIndex) => {
    const { board, setBoard, setError } = get()
    if (!board) return
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return

    const prevBoard = board

    // Optimistic Update
    const tasks = [...board.tasks]
    const taskIndex = tasks.findIndex(t => t.id === taskId)
    if (taskIndex === -1) return

    const task = { ...tasks[taskIndex], status: toStatus }
    tasks.splice(taskIndex, 1)

    // Get tasks in target column to calculate order
    const targetTasks = tasks
      .filter(t => t.status === toStatus && !t.archived)
      .sort((a, b) => a.order - b.order)
    
    targetTasks.splice(toIndex, 0, task)
    
    // Re-order target column
    targetTasks.forEach((t, i) => {
      t.order = i
    })

    // Update the main tasks array with re-ordered target tasks
    const otherTasks = tasks.filter(t => t.status !== toStatus || t.archived)
    const newTasks = [...otherTasks, ...targetTasks]

    setBoard({ ...board, tasks: newTasks })

    try {
      const client = getBackendClient()
      const res: any = await client?.rpc('kanban.moveTask', {
        workspaceId,
        taskId,
        toStatus,
        toIndex,
      })
      if (!res?.ok) throw new Error(res?.error || 'Move rejected')
    } catch (err) {
      setBoard(prevBoard)
      setError('Failed to move task')
      console.error('[kanban] moveTask failed:', err)
    }
  },

  createTask: async (input) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.createTask', { workspaceId, input })
      if (!res?.ok) throw new Error(res?.error || 'Create rejected')
      notifications.show({ color: 'green', title: 'Task created', message: `Added "${input.title}" to the board.` })
    } catch (err) {
      setError(String(err))
      throw err
    }
  },

  updateTask: async (taskId, patch) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.updateTask', { workspaceId, taskId, patch })
      if (!res?.ok) throw new Error(res?.error || 'Update rejected')
      notifications.show({ color: 'green', title: 'Task updated', message: `Saved changes.` })
    } catch (err) {
      setError(String(err))
      throw err
    }
  },

  deleteTask: async (taskId) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { board, setBoard, setError } = get()
    if (!board) return

    const prevBoard = board
    const confirmed = window.confirm('Delete this task?')
    if (!confirmed) return

    // Optimistic delete
    setBoard({ ...board, tasks: board.tasks.filter(t => t.id !== taskId) })

    try {
      const res: any = await getBackendClient()?.rpc('kanban.deleteTask', { workspaceId, taskId })
      if (!res?.ok) throw new Error(res?.error || 'Delete rejected')
      notifications.show({ color: 'green', title: 'Task deleted', message: 'The task was removed.' })
    } catch (err) {
      setBoard(prevBoard)
      setError(String(err))
    }
  },

  createEpic: async (input) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.createEpic', { workspaceId, input })
      if (!res?.ok) throw new Error(res?.error || 'Create rejected')
      notifications.show({ color: 'green', title: 'Epic created', message: `Created epic "${input.name}".` })
    } catch (err) {
      setError(String(err))
      throw err
    }
  },

  updateEpic: async (epicId, patch) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.updateEpic', { workspaceId, epicId, patch })
      if (!res?.ok) throw new Error(res?.error || 'Update rejected')
      notifications.show({ color: 'green', title: 'Epic updated', message: `Updated epic.` })
    } catch (err) {
      setError(String(err))
      throw err
    }
  },

  deleteEpic: async (epicId) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { board, setBoard, setError } = get()
    if (!board) return

    const confirmed = window.confirm('Delete this epic? Tasks will be unassigned.')
    if (!confirmed) return

    const prevBoard = board
    // Optimistic delete epic and unassign tasks
    setBoard({
      ...board,
      epics: board.epics.filter(e => e.id !== epicId),
      tasks: board.tasks.map(t => t.epicId === epicId ? { ...t, epicId: null } : t)
    })

    try {
      const res: any = await getBackendClient()?.rpc('kanban.deleteEpic', { workspaceId, epicId })
      if (!res?.ok) throw new Error(res?.error || 'Delete rejected')
      notifications.show({ color: 'green', title: 'Epic deleted', message: 'The epic was removed.' })
    } catch (err) {
      setBoard(prevBoard)
      setError(String(err))
    }
  },

  archiveTasks: async (olderThan) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.archiveTasks', { workspaceId, olderThan })
      if (!res?.ok) throw new Error(res?.error || 'Archive failed')
      const count = res.archivedCount ?? 0
      notifications.show({
        color: 'green',
        title: 'Tasks archived',
        message: `Archived ${count} task${count !== 1 ? 's' : ''}.`
      })
    } catch (err) {
      setError(String(err))
    }
  },

  logWorkOnTask: async (taskId, message) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.logWorkOnTask', { workspaceId, taskId, message })
      if (!res?.ok) throw new Error(res?.error || 'Log failed')
    } catch (err) {
      setError(String(err))
      throw err
    }
  },

  getTask: async (taskId) => {
    const workspaceId = useBackendBinding.getState().workspaceId
    if (!workspaceId) return null
    const { setError } = get()

    try {
      const res: any = await getBackendClient()?.rpc('kanban.getTask', { workspaceId, taskId })
      if (!res?.ok) throw new Error(res?.error || 'Get task failed')
      return res.task || null
    } catch (err) {
      setError(String(err))
      return null
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

  client.subscribe('workspace.attached', (p: any) => {
    // Force hydration with the ID from the event to avoid race conditions with binding store
    const workspaceId = p?.workspaceId || p?.id || p?.root
    if (workspaceId) {
       useKanban.getState().hydrateBoard().catch(() => {})
    }
  })

  // Board changed - always update loading/saving/error, but board update is conditional
  client.subscribe('kanban.board.changed', (p: any) => {
    // Check if this update is for our current workspace
    const currentWorkspaceId = useBackendBinding.getState().workspaceId
    if (p?.workspaceId && currentWorkspaceId && p.workspaceId !== currentWorkspaceId) {
      return
    }

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

