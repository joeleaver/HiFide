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
  writeKanbanBoard,
} from '../utils/kanban'

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
    title: string
    status?: KanbanStatus
    epicId?: string | null
    description?: string
    assignees?: string[]
    tags?: string[]
  }) => Promise<KanbanTask | null>
  kanbanUpdateTask: (
    taskId: string,
    patch: Partial<Omit<KanbanTask, 'id' | 'createdAt' | 'order' | 'status'>> & {
      status?: KanbanStatus
      description?: string | null
      epicId?: string | null
      assignees?: string[]
      tags?: string[]
    },
  ) => Promise<KanbanTask | null>
  kanbanDeleteTask: (taskId: string) => Promise<{ ok: boolean }>
  kanbanMoveTask: (params: { taskId: string; toStatus: KanbanStatus; toIndex: number }) => Promise<{ ok: boolean }>

  kanbanCreateEpic: (input: { name: string; color?: string; description?: string }) => Promise<KanbanEpic | null>
  kanbanUpdateEpic: (
    epicId: string,
    patch: Partial<Omit<KanbanEpic, 'id' | 'createdAt'>>,
  ) => Promise<KanbanEpic | null>
  kanbanDeleteEpic: (epicId: string) => Promise<{ ok: boolean }>
}

type KanbanStore = KanbanSlice & { workspaceRoot?: string | null }

type PartialSetter = (partial: Partial<KanbanSlice>) => void

function resolveWorkspaceRoot(get: () => KanbanStore): string {
  const root = get().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT
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
}): Promise<void> {
  const { board, get, setPartial } = params
  const workspaceRoot = resolveWorkspaceRoot(get)

  // Only toggle saving and error before writing; do not update board or timestamps here
  setPartial({ kanbanSaving: true, kanbanError: null })
  try {
    await writeKanbanBoard(workspaceRoot, board)
    // On success, commit the new board. Avoid touching kanbanLastLoadedAt here
    setPartial({ kanbanSaving: false, kanbanBoard: board })
  } catch (error) {
    console.error('[kanban] Failed to persist board:', error)
    // Do not revert board here since we didn't optimistically set it
    setPartial({ kanbanSaving: false, kanbanError: String(error) })
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
        setPartial({ kanbanBoard: board, kanbanLoading: false, kanbanLastLoadedAt: Date.now() })
        return { ok: true, board }
      } catch (error) {
        console.error('[kanban] Load failed:', error)
        setPartial({ kanbanLoading: false, kanbanError: String(error) })
        return { ok: false }
      }
    },

    async kanbanRefreshFromDisk() {
      try {
        const workspaceRoot = resolveWorkspaceRoot(get as () => KanbanStore)
        const board = await readKanbanBoard(workspaceRoot)
        setPartial({ kanbanBoard: board, kanbanError: null, kanbanLastLoadedAt: Date.now() })
        return { ok: true, board }
      } catch (error) {
        console.error('[kanban] Refresh failed:', error)
        setPartial({ kanbanError: String(error) })
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
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return task
      } catch (error) {
        return null
      }
    },

    async kanbanUpdateTask(taskId, patch) {
      const board = get().kanbanBoard
      if (!board) return null

      const task = findTask(board, taskId)
      if (!task) return null

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
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return updatedTask
      } catch (error) {
        return null
      }
    },

    async kanbanDeleteTask(taskId) {
      const board = get().kanbanBoard
      if (!board) return { ok: false }
      if (!findTask(board, taskId)) return { ok: false }

      const previous = board
      const filtered = board.tasks.filter((task) => task.id !== taskId)
      const updatedBoard = reindexOrders({ ...board, tasks: filtered })

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return { ok: true }
      } catch (error) {
        return { ok: false }
      }
    },

    async kanbanMoveTask({ taskId, toStatus, toIndex }) {
      const board = get().kanbanBoard
      if (!board) return { ok: false }

      const task = findTask(board, taskId)
      if (!task) return { ok: false }

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
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return { ok: true }
      } catch (error) {
        return { ok: false }
      }
    },

    async kanbanCreateEpic({ name, color, description }) {
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
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return epic
      } catch (error) {
        return null
      }
    },

    async kanbanUpdateEpic(epicId, patch) {
      const board = get().kanbanBoard
      if (!board) return null

      const epic = findEpic(board, epicId)
      if (!epic) return null

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
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return updatedEpic
      } catch (error) {
        return null
      }
    },

    async kanbanDeleteEpic(epicId) {
      const board = get().kanbanBoard
      if (!board) return { ok: false }
      if (!findEpic(board, epicId)) return { ok: false }

      const previous = board
      const updatedBoard: KanbanBoard = {
        ...board,
        epics: board.epics.filter((epic) => epic.id !== epicId),
        tasks: board.tasks.map((task) =>
          task.epicId === epicId ? { ...task, epicId: null, updatedAt: Date.now() } : task,
        ),
      }

      try {
        await persistBoard({ board: updatedBoard, previous, get: get as () => KanbanStore, setPartial })
        return { ok: true }
      } catch (error) {
        return { ok: false }
      }
    },
  }
}
