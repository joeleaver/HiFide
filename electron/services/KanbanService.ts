/**
 * Kanban Service
 * 
 * Provides persistence and CRUD helpers for Kanban board tasks and epics.
 */

import path from 'node:path'
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

interface KanbanWorkspaceState {
  board: KanbanBoard | null
  loading: boolean
  saving: boolean
  error: string | null
  lastLoadedAt: number | null
}

interface KanbanState {
  workspaces: Record<string, KanbanWorkspaceState>
}

export class KanbanService extends Service<KanbanState> {
  constructor() {
    super({ workspaces: {} })
  }

  protected onStateChange(): void {
    // Workspace-scoped notifications are emitted explicitly via updateWorkspaceState
  }

  private createWorkspaceState(): KanbanWorkspaceState {
    return {
      board: null,
      loading: false,
      saving: false,
      error: null,
      lastLoadedAt: null,
    }
  }

  private normalizeWorkspaceId(workspaceId: string): string {
    if (!workspaceId) {
      throw new Error('Workspace ID is required. Kanban board is workspace-scoped.')
    }
    try {
      return path.resolve(workspaceId)
    } catch {
      return workspaceId
    }
  }

  private sanitizeKbArticleId(value?: string | null): string | null {
    if (value === undefined || value === null) return value ?? null
    const trimmed = String(value).trim()
    return trimmed.length ? trimmed : null
  }

  private getWorkspaceState(workspaceId: string): KanbanWorkspaceState {
    const normalized = this.normalizeWorkspaceId(workspaceId)
    return this.state.workspaces[normalized] ?? this.createWorkspaceState()
  }

  private updateWorkspaceState(
    workspaceId: string,
    updates: Partial<KanbanWorkspaceState>
  ): KanbanWorkspaceState {
    const normalized = this.normalizeWorkspaceId(workspaceId)
    const prev = this.getWorkspaceState(normalized)
    const next = { ...prev, ...updates }
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: next,
      },
    })
    this.emitWorkspaceChange(normalized, next)
    return next
  }

  private emitWorkspaceChange(workspaceId: string, state: KanbanWorkspaceState): void {
    this.events.emit('kanban:board:changed', {
      workspaceId,
      board: state.board,
      loading: state.loading,
      saving: state.saving,
      error: state.error,
      lastLoadedAt: state.lastLoadedAt,
    })
  }

  // Getters
  getBoard(workspaceId: string): KanbanBoard | null {
    return this.getWorkspaceState(workspaceId).board
  }

  isLoading(workspaceId: string): boolean {
    return this.getWorkspaceState(workspaceId).loading
  }

  isSaving(workspaceId: string): boolean {
    return this.getWorkspaceState(workspaceId).saving
  }

  getError(workspaceId: string): string | null {
    return this.getWorkspaceState(workspaceId).error
  }

  getLastLoadedAt(workspaceId: string): number | null {
    return this.getWorkspaceState(workspaceId).lastLoadedAt
  }

  // Helper methods
  private async resolveWorkspaceRoot(workspaceId: string): Promise<string> {
    return this.normalizeWorkspaceId(workspaceId)
  }

  private async persistBoard(params: {
    board: KanbanBoard
    workspaceId: string
    immediate?: boolean
  }): Promise<void> {
    const { board, workspaceId, immediate = false } = params
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)

    this.updateWorkspaceState(workspaceRoot, { saving: true, error: null })
    try {
      await kanbanSaver.save(workspaceRoot, board, immediate)
      const state = this.updateWorkspaceState(workspaceRoot, { saving: false, board, error: null })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: state.loading,
          saving: state.saving,
          error: state.error,
          lastLoadedAt: state.lastLoadedAt,
        })
      } catch {}
    } catch (error) {
      const message = String(error)
      const state = this.updateWorkspaceState(workspaceRoot, { saving: false, error: message })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: state.board,
          loading: state.loading,
          saving: state.saving,
          error: message,
          lastLoadedAt: state.lastLoadedAt,
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
  async kanbanLoadFor(workspaceId: string): Promise<{ ok: boolean; board?: KanbanBoard }> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    this.updateWorkspaceState(workspaceRoot, { loading: true, error: null })
    try {
      const board = await readKanbanBoard(workspaceRoot)
      const ts = Date.now()
      const state = this.updateWorkspaceState(workspaceRoot, {
        board,
        loading: false,
        lastLoadedAt: ts,
        error: null,
      })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: state.loading,
          saving: state.saving,
          error: state.error,
          lastLoadedAt: ts,
        })
      } catch {}
      return { ok: true, board }
    } catch (error) {
      const message = String(error)
      const state = this.updateWorkspaceState(workspaceRoot, { loading: false, error: message })
      console.error('[kanban] Load failed:', error)
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: state.board,
          loading: state.loading,
          saving: state.saving,
          error: message,
          lastLoadedAt: state.lastLoadedAt,
        })
      } catch {}
      return { ok: false }
    }
  }

  async kanbanRefreshFromDiskFor(workspaceId: string): Promise<{ ok: boolean; board?: KanbanBoard }> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    try {
      const board = await readKanbanBoard(workspaceRoot)
      const ts = Date.now()
      const state = this.updateWorkspaceState(workspaceRoot, {
        board,
        error: null,
        lastLoadedAt: ts,
      })
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board,
          loading: state.loading,
          saving: state.saving,
          error: state.error,
          lastLoadedAt: ts,
        })
      } catch {}
      return { ok: true, board }
    } catch (error) {
      const message = String(error)
      const state = this.updateWorkspaceState(workspaceRoot, { error: message })
      console.error('[kanban] Refresh failed:', error)
      try {
        broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', {
          board: state.board,
          loading: state.loading,
          saving: state.saving,
          error: message,
          lastLoadedAt: state.lastLoadedAt,
        })
      } catch {}
      return { ok: false }
    }
  }

  async kanbanCreateTask(input: {
    workspaceId: string
    title: string
    status?: KanbanStatus
    epicId?: string | null
    kbArticleId?: string | null
    description?: string
    assignees?: string[]
    tags?: string[]
    worklog?: string[]
  }): Promise<KanbanTask> {
    const workspaceRoot = await this.resolveWorkspaceRoot(input.workspaceId)
    let board = this.getWorkspaceState(workspaceRoot).board
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
      kbArticleId: this.sanitizeKbArticleId(input.kbArticleId),
      assignees: input.assignees ? [...input.assignees] : [],
      tags: input.tags ? [...input.tags] : [],
      worklog: input.worklog ? [...input.worklog] : [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }


    const updatedBoard = reindexOrders({
      ...board,
      columns: board.columns.length ? board.columns : [...KANBAN_STATUSES],
      tasks: [...board.tasks, task],
    })

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
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
      worklog?: string[]
    },
    workspaceId: string
  ): Promise<KanbanTask> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) throw new Error('Board not loaded')

    const task = this.findTask(board, taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    const updatedTask: KanbanTask = {
      ...task,
      ...patch,
      status: patch.status ?? task.status,
      description: patch.description ?? task.description ?? '',
      epicId: patch.epicId === undefined ? task.epicId ?? null : patch.epicId ?? null,
      kbArticleId:
        patch.kbArticleId === undefined
          ? task.kbArticleId ?? null
          : this.sanitizeKbArticleId(patch.kbArticleId),
      assignees: patch.assignees ? [...patch.assignees] : task.assignees,
      tags: patch.tags ? [...patch.tags] : task.tags,
      worklog: patch.worklog ? [...patch.worklog] : task.worklog,
      updatedAt: Date.now(),
    }


    const updatedBoard = reindexOrders({
      ...board,
      tasks: board.tasks.map((existing) => (existing.id === taskId ? updatedTask : existing)),
    })

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return updatedTask
    } catch (error) {
      console.error('[kanban] kanbanUpdateTask failed:', error)
      throw error
    }
  }

  async kanbanDeleteTask(
    taskId: string,
    workspaceId: string
  ): Promise<{ ok: boolean; deleted?: { taskId: string }; error?: string; code?: string }> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
    const existing = this.findTask(board, taskId)
    if (!existing) return { ok: false, error: 'Task not found', code: 'NOT_FOUND' }


    const filtered = board.tasks.filter((task) => task.id !== taskId)
    const updatedBoard = reindexOrders({ ...board, tasks: filtered })

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return { ok: true, deleted: { taskId } }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanMoveTask(params: {
    taskId: string
    toStatus: KanbanStatus
    toIndex: number
    workspaceId: string
  }): Promise<{ ok: boolean; task?: KanbanTask | null; error?: string; code?: string }> {
    const { taskId, toStatus, toIndex, workspaceId } = params
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
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


    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      const moved = updatedBoard.tasks.find((t) => t.id === taskId) || null
      return { ok: true, task: moved }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanCreateEpic(params: {
    workspaceId: string
    name: string
    color: string
    description: string
  }): Promise<KanbanEpic> {
    const workspaceRoot = await this.resolveWorkspaceRoot(params.workspaceId)
    let board = this.getWorkspaceState(workspaceRoot).board
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


    const updatedBoard: KanbanBoard = {
      ...board,
      epics: [...board.epics, epic],
    }

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return epic
    } catch (error) {
      console.error('[kanban] kanbanCreateEpic failed:', error)
      throw error
    }
  }

  async kanbanUpdateEpic(
    epicId: string,
    patch: Partial<Omit<KanbanEpic, 'id' | 'createdAt'>>,
    workspaceId: string
  ): Promise<KanbanEpic> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) throw new Error('Board not loaded')

    const epic = this.findEpic(board, epicId)
    if (!epic) throw new Error(`Epic not found: ${epicId}`)

    const updatedEpic: KanbanEpic = {
      ...epic,
      ...patch,
      updatedAt: Date.now(),
    }


    const updatedBoard: KanbanBoard = {
      ...board,
      epics: board.epics.map((existing) => (existing.id === epicId ? updatedEpic : existing)),
    }

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return updatedEpic
    } catch (error) {
      console.error('[kanban] kanbanUpdateEpic failed:', error)
      throw error
    }
  }

  async kanbanDeleteEpic(
    epicId: string,
    workspaceId: string
  ): Promise<{ ok: boolean; deleted?: { epicId: string }; error?: string; code?: string }> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) return { ok: false, error: 'Board not loaded', code: 'NOT_LOADED' }
    const epic = this.findEpic(board, epicId)
    if (!epic) return { ok: false, error: 'Epic not found', code: 'NOT_FOUND' }


    const updatedBoard: KanbanBoard = {
      ...board,
      epics: board.epics.filter((e) => e.id !== epicId),
      tasks: board.tasks.map((task) =>
        task.epicId === epicId ? { ...task, epicId: null, updatedAt: Date.now() } : task
      ),
    }

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return { ok: true, deleted: { epicId } }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  async kanbanLogWorkOnTask(
    taskId: string,
    message: string,
    workspaceId: string
  ): Promise<KanbanTask> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) throw new Error('Board not loaded')

    const task = this.findTask(board, taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    const updatedTask: KanbanTask = {
      ...task,
      worklog: [...(task.worklog || []), message],
      updatedAt: Date.now(),
    }

    const updatedBoard = {
      ...board,
      tasks: board.tasks.map((existing) => (existing.id === taskId ? updatedTask : existing)),
    }

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot })
      return updatedTask
    } catch (error) {
      console.error('[kanban] kanbanLogWorkOnTask failed:', error)
      throw error
    }
  }

  async kanbanGetTask(
    taskId: string,
    workspaceId: string
  ): Promise<KanbanTask | null> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) {
      const res = await this.kanbanLoadFor(workspaceId)
      if (!res.ok || !res.board) return null
      return this.findTask(res.board, taskId) || null
    }
    return this.findTask(board, taskId) || null
  }

  async kanbanArchiveTasks(params: {
    olderThan: number
    workspaceId: string
  }): Promise<{ ok: boolean; archivedCount?: number; error?: string }> {
    const workspaceRoot = await this.resolveWorkspaceRoot(params.workspaceId)
    const board = this.getWorkspaceState(workspaceRoot).board
    if (!board) return { ok: false, error: 'Board not loaded' }

    const timestamp = Date.now()

    // Find done tasks that were updated before the cutoff and aren't already archived
    const tasksToArchive = board.tasks.filter(
      (task) => task.status === 'done' && task.updatedAt < params.olderThan && !task.archived
    )

    if (tasksToArchive.length === 0) {
      return { ok: true, archivedCount: 0 }
    }


    const updatedBoard: KanbanBoard = {
      ...board,
      tasks: board.tasks.map((task) =>
        tasksToArchive.some((t) => t.id === task.id) ? { ...task, archived: true, archivedAt: timestamp } : task
      ),
    }

    try {
      await this.persistBoard({ board: updatedBoard, workspaceId: workspaceRoot, immediate: true })
      return { ok: true, archivedCount: tasksToArchive.length }
    } catch (error) {
      console.error('[kanban] archiveTasks failed:', error)
      return { ok: false, error: String(error) }
    }
  }
}
