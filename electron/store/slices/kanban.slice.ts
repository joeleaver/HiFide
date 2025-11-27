/**
 * Kanban Slice
 *
 * Provides persistence and CRUD helpers for Kanban board tasks and epics.
 */

import { randomUUID } from 'node:crypto'
import type { StateCreator } from 'zustand'
import type { KanbanBoard, KanbanEpic, KanbanStatus, KanbanTask } from '../types'
import {
  KANBAN_STATUSES,
  applyTaskOrder,
  createDefaultKanbanBoard,
  nextOrderForStatus,
  readKanbanBoard,
  reindexOrders,
  kanbanSaver,
} from '../utils/kanban'
import { broadcastWorkspaceNotification } from '../../backend/ws/broadcast'


export interface KanbanSlice {
  kanbanBoard: KanbanBoard | null
  kanbanLoading: boolean
  kanbanSaving: boolean
  kanbanError: string | null
  kanbanLastLoadedAt: number | null

  kanbanLoad: () => Promise<{ ok: boolean; board?: KanbanBoard }>
  kanbanRefreshFromDisk: () => Promise<{ ok: boolean; board?: KanbanBoard }>
  kanbanSave: () => Promise<{ ok: boolean }>

  kanbanCreateTask: (input: {
    workspaceId?: string
    title: string
    status?: KanbanStatus
    epicId?: string | null
    description?: string
    assignees?: string[]
    tags?: string[]
  }) => Promise<KanbanTask>
  kanbanUpdateTask: (
    taskId: string,
    patch: Partial<Omit<KanbanTask, 'id' | 'createdAt' | 'order' | 'status'>> & {
      status?: KanbanStatus
      description?: string | null
      epicId?: string | null
      assignees?: string[]
      tags?: string[]
    },
    workspaceId?: string
  ) => Promise<KanbanTask>
  kanbanDeleteTask: (taskId: string, workspaceId?: string) => Promise<{ ok: boolean }>
  kanbanMoveTask: (params: { taskId: string; toStatus: KanbanStatus; toIndex: number; workspaceId?: string }) => Promise<{ ok: boolean }>

  kanbanCreateEpic: (input: { workspaceId?: string; name: string; color?: string; description?: string }) => Promise<KanbanEpic>
  kanbanUpdateEpic: (
    epicId: string,
    patch: Partial<Omit<KanbanEpic, 'id' | 'createdAt'>>,
    workspaceId?: string
  ) => Promise<KanbanEpic>
  kanbanDeleteEpic: (epicId: string, workspaceId?: string) => Promise<{ ok: boolean }>
  kanbanArchiveTasks: (params: { olderThan: number; workspaceId?: string }) => Promise<{ ok: boolean; archivedCount?: number; error?: string }>
}

type KanbanStore = KanbanSlice & { workspaceRoot?: string | null }

type PartialSetter = (partial: Partial<KanbanSlice>) => void

function resolveWorkspaceRoot(get: () => KanbanStore, workspaceId?: string): string {
  const root = workspaceId || get().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT
  if (!root) {
    throw new Error('Workspace root is not set. Open a workspace before using the Kanban board.')
  }
  return root
}

async function persistBoard(params: {
  board: KanbanBoard
  previous: KanbanBoard | null
  get: () => KanbanStore
  setPartial: PartialSetter
  workspaceId?: string
  immediate?: boolean
}): Promise<void> {
  const { board, get, setPartial, workspaceId, immediate = false } = params
  const workspaceRoot = resolveWorkspaceRoot(get, workspaceId)

  // Only toggle saving and error before writing; do not update board or timestamps here
  setPartial({ kanbanSaving: true, kanbanError: null })
  try {
    // Use debounced saver to prevent concurrent writes
    await kanbanSaver.save(workspaceRoot, board, immediate)
    // On success, commit the new board. Avoid touching kanbanLastLoadedAt here
    setPartial({ kanbanSaving: false, kanbanBoard: board })
    // Notify workspace-bound renderers that the board has changed
    try {
      const lastLoadedAt = (get() as any).kanbanLastLoadedAt || null
      broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
        board,
        loading: false,
        saving: false,
        error: null,
        lastLoadedAt,
      })
    } catch { }
  } catch (error) {
    console.error('[kanban] Failed to persist board:', error)
    // Do not revert board here since we didn't optimistically set it
    setPartial({ kanbanSaving: false, kanbanError: String(error) })
    try {
      const current = (get() as any).kanbanBoard || null
      const lastLoadedAt = (get() as any).kanbanLastLoadedAt || null
      broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
        board: current,
        loading: false,
        saving: false,
        error: String(error),
        lastLoadedAt,
      })
    } catch { }
    throw error
  }
}

function findTask(board: KanbanBoard, taskId: string): KanbanTask | undefined {
  return board.tasks.find((task) => task.id === taskId)
}

function findEpic(board: KanbanBoard, epicId: string): KanbanEpic | undefined {
  return board.epics.find((epic) => epic.id === epicId)
}

export const createKanbanSlice: StateCreator<KanbanSlice, [], [], KanbanSlice> = (set, get) => {
  const setPartial: PartialSetter = (partial) => set(partial as KanbanSlice)

  return {
    kanbanBoard: null,
    kanbanLoading: false,
    kanbanSaving: false,
    kanbanError: null,
    kanbanLastLoadedAt: null,

    async kanbanLoad() {
      try {
        const workspaceRoot = resolveWorkspaceRoot(get as () => KanbanStore)
        setPartial({ kanbanLoading: true, kanbanError: null })
        const board = await readKanbanBoard(workspaceRoot)
        const ts = Date.now()
        setPartial({ kanbanBoard: board, kanbanLoading: false, kanbanLastLoadedAt: ts })
        try { broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', { board, loading: false, saving: false, error: null, lastLoadedAt: ts }) } catch { }
        return { ok: true, board }
      } catch (error) {
        console.error('[kanban] Load failed:', error)
        setPartial({ kanbanLoading: false, kanbanError: String(error) })
        try {
          const workspaceRoot = resolveWorkspaceRoot(get as () => KanbanStore)
          broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', { board: null, loading: false, saving: false, error: String(error) })
        } catch { }
        return { ok: false }
      }
    },

    async kanbanRefreshFromDisk() {
      try {
        const workspaceRoot = resolveWorkspaceRoot(get as () => KanbanStore)
        const board = await readKanbanBoard(workspaceRoot)
        const ts = Date.now()
        setPartial({ kanbanBoard: board, kanbanError: null, kanbanLastLoadedAt: ts })
        try { broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', { board, loading: false, saving: false, error: null, lastLoadedAt: ts }) } catch { }
        return { ok: true, board }
      } catch (error) {
        console.error('[kanban] Refresh failed:', error)
        setPartial({ kanbanError: String(error) })
        try {
          const workspaceRoot = resolveWorkspaceRoot(get as () => KanbanStore)
          broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', { board: (get() as any).kanbanBoard || null, loading: false, saving: false, error: String(error), lastLoadedAt: (get() as any).kanbanLastLoadedAt || null })
        } catch { }
        return { ok: false }
      }
    },

    async kanbanSave() {
      const board = get().kanbanBoard
      if (!board) return { ok: false }

      try {
        await persistBoard({ board, previous: board, get: get as () => KanbanStore, setPartial })
        return { ok: true }
      } catch (error) {
        console.error('[kanban] Save failed:', error)
        return { ok: false }
      }
    },

    async kanbanCreateTask(input) {
      let board = get().kanbanBoard
      if (!board) {
        board = createDefaultKanbanBoard()
      }

      const timestamp = Date.now()
      const status = input.status ?? 'backlog'
      const task: KanbanTask = {
        id: `task-${randomUUID()}`,
        title: input.title,
        status,
        order: nextOrderForStatus(board, status),
        description: input.description ?? '',
        epicId: input.epicId ?? null,
        assignees: input.assignees ? [...input.assignees] : [],
        tags: input.tags ? [...input.tags] : [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      const previous = board
      const updatedBoard = reindexOrders({
        ...board,
        columns: board.columns.length ? board.columns : [...KANBAN_STATUSES],
        tasks: [...board.tasks, task],
      })

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId: input.workspaceId })
        return task
      } catch (error) {
        console.error('[kanban] kanbanCreateTask failed:', error)
        throw error
      }
    },

    async kanbanUpdateTask(taskId, patch, workspaceId) {
      const board = get().kanbanBoard
      if (!board) throw new Error('Board not loaded')

      const task = findTask(board, taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)

      const updatedTask: KanbanTask = {
        ...task,
        ...patch,
        status: patch.status ?? task.status,
        description: patch.description ?? task.description ?? '',
        epicId: patch.epicId === undefined ? task.epicId ?? null : patch.epicId ?? null,
        assignees: patch.assignees ? [...patch.assignees] : task.assignees,
        tags: patch.tags ? [...patch.tags] : task.tags,
        updatedAt: Date.now(),
      }

      const previous = board
      const updatedBoard = reindexOrders({
        ...board,
        tasks: board.tasks.map((existing) => (existing.id === taskId ? updatedTask : existing)),
      })

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        return updatedTask
      } catch (error) {
        console.error('[kanban] kanbanUpdateTask failed:', error)
        throw error
      }
    },

    async kanbanDeleteTask(taskId, workspaceId) {
      const board = get().kanbanBoard
      if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
      const existing = findTask(board, taskId)
      if (!existing) return { ok: false, error: 'Task not found', code: 'NOT_FOUND' }

      const previous = board
      const filtered = board.tasks.filter((task) => task.id !== taskId)
      const updatedBoard = reindexOrders({ ...board, tasks: filtered })

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        return { ok: true, deleted: { taskId } }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    },

    async kanbanMoveTask({ taskId, toStatus, toIndex, workspaceId }) {
      const board = get().kanbanBoard
      if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }

      const task = findTask(board, taskId)
      if (!task) return { ok: false, error: 'Task not found', code: 'NOT_FOUND' }

      const destinationTasks = board.tasks
        .filter((existing) => existing.id !== taskId && existing.status === toStatus)
        .sort((a, b) => a.order - b.order)

      const targetIndex = Math.max(0, Math.min(toIndex, destinationTasks.length))
      destinationTasks.splice(targetIndex, 0, { ...task, status: toStatus })

      let intermediate = applyTaskOrder(board, toStatus, destinationTasks)
      if (task.status !== toStatus) {
        const remainingSource = intermediate.tasks
          .filter((existing) => existing.status === task.status && existing.id !== taskId)
          .sort((a, b) => a.order - b.order)
        intermediate = applyTaskOrder(intermediate, task.status, remainingSource)
      }

      const updatedBoard = {
        ...intermediate,
        tasks: intermediate.tasks.map((existing) =>
          existing.id === taskId ? { ...existing, status: toStatus, updatedAt: Date.now() } : existing,
        ),
      }

      const previous = board
      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        const moved = updatedBoard.tasks.find((t) => t.id === taskId) || null
        return { ok: true, task: moved }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    },

    async kanbanCreateEpic({ workspaceId, name, color, description }) {
      let board = get().kanbanBoard
      if (!board) {
        board = createDefaultKanbanBoard()
      }

      const timestamp = Date.now()
      const epic: KanbanEpic = {
        id: `epic-${randomUUID()}`,
        name,
        color,
        description,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      const previous = board
      const updatedBoard: KanbanBoard = {
        ...board,
        epics: [...board.epics, epic],
      }

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        return epic
      } catch (error) {
        console.error('[kanban] kanbanCreateEpic failed:', error)
        throw error
      }
    },

    async kanbanUpdateEpic(epicId, patch, workspaceId) {
      const board = get().kanbanBoard
      if (!board) throw new Error('Board not loaded')

      const epic = findEpic(board, epicId)
      if (!epic) throw new Error(`Epic not found: ${epicId}`)

      const updatedEpic: KanbanEpic = {
        ...epic,
        ...patch,
        updatedAt: Date.now(),
      }

      const previous = board
      const updatedBoard: KanbanBoard = {
        ...board,
        epics: board.epics.map((existing) => (existing.id === epicId ? updatedEpic : existing)),
      }

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        return updatedEpic
      } catch (error) {
        console.error('[kanban] kanbanUpdateEpic failed:', error)
        throw error
      }
    },

    async kanbanDeleteEpic(epicId, workspaceId) {
      const board = get().kanbanBoard
      if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
      const epic = findEpic(board, epicId)
      if (!epic) return { ok: false, error: 'Epic not found', code: 'NOT_FOUND' }

      const previous = board
      const updatedBoard: KanbanBoard = {
        ...board,
        epics: board.epics.filter((e) => e.id !== epicId),
        tasks: board.tasks.map((task) =>
          task.epicId === epicId ? { ...task, epicId: null, updatedAt: Date.now() } : task,
        ),
      }

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId })
        return { ok: true, deleted: { epicId } }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    },

    async kanbanArchiveTasks({ olderThan, workspaceId }) {
      const board = get().kanbanBoard
      if (!board) return { ok: false, error: 'Board not loaded' }

      const timestamp = Date.now()

      // Find done tasks that were updated before the cutoff and aren't already archived
      const tasksToArchive = board.tasks.filter(
        (task) =>
          task.status === 'done' &&
          task.updatedAt < olderThan &&
          !task.archived
      )

      if (tasksToArchive.length === 0) {
        return { ok: true, archivedCount: 0 }
      }

      const previous = board
      const updatedBoard: KanbanBoard = {
        ...board,
        tasks: board.tasks.map((task) =>
          tasksToArchive.some((t) => t.id === task.id)
            ? { ...task, archived: true, archivedAt: timestamp }
            : task
        ),
      }

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial, workspaceId, immediate: true })
        return { ok: true, archivedCount: tasksToArchive.length }
      } catch (error) {
        console.error('[kanban] archiveTasks failed:', error)
        return { ok: false, error: String(error) }
      }
    },
  }
}
