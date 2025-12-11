import { getKanbanService } from '../../../services/index.js'

export function createKanbanHandlers(addMethod: (method: string, handler: (params: any) => any) => void): void {
  const kanbanService = getKanbanService()

  // Move task between columns
  addMethod('kanban.moveTask', async (params: any) => {
    const { taskId, toStatus, toIndex, workspaceId } = params
    if (!taskId || !toStatus || toIndex === undefined) {
      throw new Error('Missing required parameters: taskId, toStatus, toIndex')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    return kanbanService.kanbanMoveTask({ taskId, toStatus, toIndex, workspaceId })
  })

  // Archive completed tasks
  addMethod('kanban.archiveTasks', async (params: any) => {
    const { olderThan, workspaceId } = params
    if (olderThan === undefined) {
      throw new Error('Missing required parameter: olderThan')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    return kanbanService.kanbanArchiveTasks({ olderThan, workspaceId })
  })

  // Create new task
  addMethod('kanban.createTask', async (params: any) => {
    const { input, workspaceId } = params
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    if (!input?.title) {
      throw new Error('Missing required parameter: input.title')
    }
    const task = await kanbanService.kanbanCreateTask({
      ...input,
      workspaceId,
    })
    return { ok: true, task }
  })

  // Update existing task
  addMethod('kanban.updateTask', async (params: any) => {
    const { taskId, patch, workspaceId } = params
    if (!taskId) {
      throw new Error('Missing required parameter: taskId')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    const task = await kanbanService.kanbanUpdateTask(taskId, patch || {}, workspaceId)
    return { ok: true, task }
  })

  // Delete task
  addMethod('kanban.deleteTask', async (params: any) => {
    const { taskId, workspaceId } = params
    if (!taskId) {
      throw new Error('Missing required parameter: taskId')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    return kanbanService.kanbanDeleteTask(taskId, workspaceId)
  })

  // Create new epic
  addMethod('kanban.createEpic', async (params: any) => {
    const { input, workspaceId } = params
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    if (!input?.name) {
      throw new Error('Missing required parameter: input.name')
    }
    const epic = await kanbanService.kanbanCreateEpic({
      ...input,
      workspaceId,
    })
    return { ok: true, epic }
  })

  // Update existing epic
  addMethod('kanban.updateEpic', async (params: any) => {
    const { epicId, patch, workspaceId } = params
    if (!epicId) {
      throw new Error('Missing required parameter: epicId')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    const epic = await kanbanService.kanbanUpdateEpic(epicId, patch || {}, workspaceId)
    return { ok: true, epic }
  })

  // Delete epic
  addMethod('kanban.deleteEpic', async (params: any) => {
    const { epicId, workspaceId } = params
    if (!epicId) {
      throw new Error('Missing required parameter: epicId')
    }
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    return kanbanService.kanbanDeleteEpic(epicId, workspaceId)
  })

  // Get current board
  addMethod('kanban.getBoard', async (params: any) => {
    const { workspaceId } = params || {}
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    const board = kanbanService.getBoard(workspaceId)
    return {
      ok: true,
      board,
      loading: kanbanService.isLoading(workspaceId),
      saving: kanbanService.isSaving(workspaceId),
      error: kanbanService.getError(workspaceId),
      lastLoadedAt: kanbanService.getLastLoadedAt(workspaceId),
    }
  })

  // Refresh board from disk
  addMethod('kanban.refreshBoard', async (params: any) => {
    const { workspaceId } = params
    if (!workspaceId) {
      throw new Error('Missing required parameter: workspaceId')
    }
    return kanbanService.kanbanRefreshFromDiskFor(workspaceId)
  })
}