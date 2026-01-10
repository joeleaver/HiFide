import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanUpdateTaskTool: AgentTool = {
  name: 'kanbanUpdateTask',
  description: 'Update a Kanban task.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'] },
      epicId: { type: 'string' },
    },
    required: ['taskId'],
  },
  run: async (input: { taskId: string; title?: string; description?: string; status?: KanbanStatus; epicId?: string | null }, meta?: any) => {
    const kanbanService = getKanbanService()
    const patch: Partial<KanbanTask> & { status?: KanbanStatus } = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.description !== undefined) patch.description = input.description
    if (input.status !== undefined) patch.status = input.status
    if (input.epicId !== undefined) patch.epicId = input.epicId ?? null
    const task: KanbanTask = await kanbanService.kanbanUpdateTask(input.taskId, patch, meta?.workspaceId)
    return { ok: true, id: task.id, title: task.title, status: task.status }
  },
}
