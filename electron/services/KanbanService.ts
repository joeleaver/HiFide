/**
 * Kanban Service
 * 
 * Provides persistence and CRUD helpers for Kanban board tasks and epics.
 */

import { randomUUID } from 'node:crypto'
import { Service } from './base/Service.js'
import type { KanbanBoard, KanbanEpic, KanbanStatus, KanbanTask } from '../store/types.js'
import {
  KANBAN_STATUSES,
  applyTaskOrder,
  createDefaultKanbanBoard,
  nextOrderForStatus,
  readKanbanBoard,
  reindexOrders,
  kanbanSaver,
} from '../store/utils/kanban.js'
import { broadcastWorkspaceNotification } from '../backend/ws/broadcast.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

interface KanbanState {
  kanbanBoard: KanbanBoard | null
  kanbanLoading: boolean
  kanbanSaving: boolean
  kanbanError: string | null
  kanbanLastLoadedAt: number | null
}

export class KanbanService extends Service<KanbanState> {
  constructor() {
    super({
      kanbanBoard: null,
      kanbanLoading: false,
      kanbanSaving: false,
      kanbanError: null,
      kanbanLastLoadedAt: null,
    })
  }

  protected onStateChange(updates: Partial<KanbanState>): void {
    // Kanban state is transient, persistence happens via explicit save operations

    // Emit events when kanban board changes
    if (
      updates.board !== undefined ||
      updates.loading !== undefined ||
      updates.saving !== undefined ||
      updates.error !== undefined ||
      updates.lastLoadedAt !== undefined
    ) {
      this.events.emit('kanban:board:changed', {
        board: this.state.board,
        loading: this.state.loading,
        saving: this.state.saving,
        error: this.state.error,
        lastLoadedAt: this.state.lastLoadedAt,
      })
    }
  }

  // Getters
  getBoard(): KanbanBoard | null {
    return this.state.kanbanBoard
  }

  isLoading(): boolean {
    return this.state.kanbanLoading
  }

  isSaving(): boolean {
    return this.state.kanbanSaving
  }

  getError(): string | null {
    return this.state.kanbanError
  }

  getLastLoadedAt(): number | null {
    return this.state.kanbanLastLoadedAt
  }

  // Helper methods
  private resolveWorkspaceRoot(workspaceId?: string): string {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const root = workspaceId || workspaceService?.getWorkspaceRoot() || process.env.HIFIDE_WORKSPACE_ROOT
    if (!root) {
      throw new Error('Workspace root is not set. Open a workspace before using the Kanban board.')
    }
    return root
  }

  private async persistBoard(params: {
    board: KanbanBoard
    previous: KanbanBoard | null
    workspaceId?: string
    immediate?: boolean
  }): Promise<void> {
    const { board, workspaceId, immediate = false } = params
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)

    this.setState({ kanbanSaving: true, kanbanError: null })
    try {
      // Use debounced saver to prevent concurrent writes
      await kanbanSaver.save(workspaceRoot, board, immediate)
      // On success, commit the new board
      this.setState({ kanbanSaving: false, kanbanBoard: board })
      // Notify workspace-bound renderers
      try {
        const lastLoadedAt = this.state.kanbanLastLoadedAt || null
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: false,
          saving: false,
          error: null,
          lastLoadedAt,
        })
      } catch {}
    } catch (error) {
      console.error('[kanban] Failed to persist board:', error)
      this.setState({ kanbanSaving: false, kanbanError: String(error) })
      try {
        const current = this.state.kanbanBoard || null
        const lastLoadedAt = this.state.kanbanLastLoadedAt || null
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: current,
          loading: false,
          saving: false,
          error: String(error),
          lastLoadedAt,
        })
      } catch {}
      throw error
    }
  }

  private findTask(board: KanbanBoard, taskId: string): KanbanTask | undefined {
    return board.tasks.find((task) => task.id === taskId)
  }

  private findEpic(board: KanbanBoard, epicId: string): KanbanEpic | undefined {
    return board.epics.find((epic) => epic.id === epicId)
  }

  // Load/Save operations
  async kanbanLoad(): Promise<{ ok: boolean; board?: KanbanBoard }> {
    try {
      const workspaceRoot = this.resolveWorkspaceRoot()
      this.setState({ kanbanLoading: true, kanbanError: null })
      const board = await readKanbanBoard(workspaceRoot)
      const ts = Date.now()
      this.setState({ kanbanBoard: board, kanbanLoading: false, kanbanLastLoadedAt: ts })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: false,
          saving: false,
          error: null,
          lastLoadedAt: ts,
        })
      } catch {}
      return { ok: true, board }
    } catch (error) {
      console.error('[kanban] Load failed:', error)
      this.setState({ kanbanLoading: false, kanbanError: String(error) })
      try {
        const workspaceRoot = this.resolveWorkspaceRoot()
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: null,
          loading: false,
          saving: false,
          error: String(error),
        })
      } catch {}
      return { ok: false }
    }
  }

  async kanbanRefreshFromDisk(): Promise<{ ok: boolean; board?: KanbanBoard }> {
    try {
      const workspaceRoot = this.resolveWorkspaceRoot()
      const board = await readKanbanBoard(workspaceRoot)
      const ts = Date.now()
      this.setState({ kanbanBoard: board, kanbanError: null, kanbanLastLoadedAt: ts })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: false,
          saving: false,
          error: null,
          lastLoadedAt: ts,
        })
      } catch {}
      return { ok: true, board }
    } catch (error) {
      console.error('[kanban] Refresh failed:', error)
      this.setState({ kanbanError: String(error) })
      try {
        const workspaceRoot = this.resolveWorkspaceRoot()
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: this.state.kanbanBoard || null,
          loading: false,
          saving: false,
          error: String(error),
          lastLoadedAt: this.state.kanbanLastLoadedAt || null,
        })
      } catch {}
      return { ok: false }
    }
  }

  async kanbanSave(): Promise<{ ok: boolean }> {
    const board = this.state.kanbanBoard
    if (!board) return { ok: false }

    try {
      await this.persistBoard({ board, previous: board })
      return { ok: true }
    } catch (error) {
      console.error('[kanban] Save failed:', error)
      return { ok: false }
    }
  }

  async kanbanCreateTask(input: {
    workspaceId?: string
    title: string
    status?: KanbanStatus
    epicId?: string | null
    description?: string
    assignees?: string[]
    tags?: string[]
  }): Promise<KanbanTask> {
    let board = this.state.kanbanBoard
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
      await this.persistBoard({ board: updatedBoard, previous, workspaceId: input.workspaceId })
      return task
    } catch (error) {
      console.error('[kanban] kanbanCreateTask failed:', error)
      throw error
    }
  }

  async kanbanUpdateTask(
    taskId: string,
    patch: Partial<Omit<KanbanTask, 'id' | 'createdAt' | 'order' | 'status'>> & {
      status?: KanbanStatus
      description?: string | null
      epicId?: string | null
      assignees?: string[]
      tags?: string[]
    },
    workspaceId?: string
  ): Promise<KanbanTask> {
    const board = this.state.kanbanBoard
    if (!board) throw new Error('Board not loaded')

    const task = this.findTask(board, taskId)
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
      await this.persistBoard({ board: updatedBoard, previous, workspaceId })
      return updatedTask
    } catch (error) {
      console.error('[kanban] kanbanUpdateTask failed:', error)
      throw error
    }
  }

  async kanbanDeleteTask(
    taskId: string,
    workspaceId?: string
  ): Promise<{ ok: boolean; deleted?: { taskId: string }; error?: string; code?: string }> {
    const board = this.state.kanbanBoard
    if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
    const existing = this.findTask(board, taskId)
    if (!existing) return { ok: false, error: 'Task not found', code: 'NOT_FOUND' }

    const previous = board
    const filtered = board.tasks.filter((task) => task.id !== taskId)
    const updatedBoard = reindexOrders({ ...board, tasks: filtered })

    try {
      await this.persistBoard({ board: updatedBoard, previous, workspaceId })
      return { ok: true, deleted: { taskId } }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanMoveTask(params: {
    taskId: string
    toStatus: KanbanStatus
    toIndex: number
    workspaceId?: string
  }): Promise<{ ok: boolean; task?: KanbanTask | null; error?: string; code?: string }> {
    const { taskId, toStatus, toIndex, workspaceId } = params
    const board = this.state.kanbanBoard
    if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }

    const task = this.findTask(board, taskId)
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
        existing.id === taskId ? { ...existing, status: toStatus, updatedAt: Date.now() } : existing
      ),
    }

    const previous = board
    try {
      await this.persistBoard({ board: updatedBoard, previous, workspaceId })
      const moved = updatedBoard.tasks.find((t) => t.id === taskId) || null
      return { ok: true, task: moved }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanCreateEpic(params: {
    workspaceId?: string
    name: string
    color: string
    description: string
  }): Promise<KanbanEpic> {
    let board = this.state.kanbanBoard
    if (!board) {
      board = createDefaultKanbanBoard()
    }

    const timestamp = Date.now()
    const epic: KanbanEpic = {
      id: `epic-${randomUUID()}`,
      name: params.name,
      color: params.color,
      description: params.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const previous = board
    const updatedBoard: KanbanBoard = {
      ...board,
      epics: [...board.epics, epic],
    }

    try {
      await this.persistBoard({ board: updatedBoard, previous, workspaceId: params.workspaceId })
      return epic
    } catch (error) {
      console.error('[kanban] kanbanCreateEpic failed:', error)
      throw error
    }
  }

  async kanbanUpdateEpic(
    epicId: string,
    patch: Partial<Omit<KanbanEpic, 'id' | 'createdAt'>>,
    workspaceId?: string
  ): Promise<KanbanEpic> {
    const board = this.state.kanbanBoard
    if (!board) throw new Error('Board not loaded')

    const epic = this.findEpic(board, epicId)
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
      await this.persistBoard({ board: updatedBoard, previous, workspaceId })
      return updatedEpic
    } catch (error) {
      console.error('[kanban] kanbanUpdateEpic failed:', error)
      throw error
    }
  }

  async kanbanDeleteEpic(
    epicId: string,
    workspaceId?: string
  ): Promise<{ ok: boolean; deleted?: { epicId: string }; error?: string; code?: string }> {
    const board = this.state.kanbanBoard
    if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
    const epic = this.findEpic(board, epicId)
    if (!epic) return { ok: false, error: 'Epic not found', code: 'NOT_FOUND' }

    const previous = board
    const updatedBoard: KanbanBoard = {
      ...board,
      epics: board.epics.filter((e) => e.id !== epicId),
      tasks: board.tasks.map((task) =>
        task.epicId === epicId ? { ...task, epicId: null, updatedAt: Date.now() } : task
      ),
    }

    try {
      await this.persistBoard({ board: updatedBoard, previous, workspaceId })
      return { ok: true, deleted: { epicId } }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanArchiveTasks(params: {
    olderThan: number
    workspaceId?: string
  }): Promise<{ ok: boolean; archivedCount?: number; error?: string }> {
    const board = this.state.kanbanBoard
    if (!board) return { ok: false, error: 'Board not loaded' }

    const timestamp = Date.now()

    // Find done tasks that were updated before the cutoff and aren't already archived
    const tasksToArchive = board.tasks.filter(
      (task) => task.status === 'done' && task.updatedAt < params.olderThan && !task.archived
    )

    if (tasksToArchive.length === 0) {
      return { ok: true, archivedCount: 0 }
    }

    const previous = board
    const updatedBoard: KanbanBoard = {
      ...board,
      tasks: board.tasks.map((task) =>
        tasksToArchive.some((t) => t.id === task.id) ? { ...task, archived: true, archivedAt: timestamp } : task
      ),
    }

    try {
      await this.persistBoard({ board: updatedBoard, previous, workspaceId: params.workspaceId, immediate: true })
      return { ok: true, archivedCount: tasksToArchive.length }
    } catch (error) {
      console.error('[kanban] archiveTasks failed:', error)
      return { ok: false, error: String(error) }
    }
  }
}
