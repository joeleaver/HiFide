import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask } from '../../store/types.js'

export const kanbanGetTaskTool: AgentTool = {
  name: 'kanbanGetTask',
  description: 'Retrieve a single Kanban task by ID.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The ID of the task to retrieve' },
    },
    required: ['taskId'],
  },
  run: async (input: { taskId: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    try {
      const task: KanbanTask | null = await kanbanService.kanbanGetTask(input.taskId, meta?.workspaceId)
      if (!task) return { ok: false, error: 'Task not found' }
      return {
        summary: `Returned task "${task.title}".`,
        task,
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  },
}
