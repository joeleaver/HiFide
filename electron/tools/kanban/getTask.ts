import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask } from '../../store/types.js'

export const kanbanGetTaskTool: AgentTool = {
  name: 'kanbanGetTask',
  description: 'Get a Kanban task by ID.',
  parameters: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
  },
  run: async (input: { taskId: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    const task: KanbanTask | null = await kanbanService.kanbanGetTask(input.taskId, meta?.workspaceId)
    if (!task) return { ok: false, error: 'Task not found' }
    return { id: task.id, title: task.title, description: task.description, status: task.status, epicId: task.epicId }
  },
}
