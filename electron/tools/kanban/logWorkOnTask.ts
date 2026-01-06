import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask } from '../../store/types.js'

export const kanbanLogWorkOnTaskTool: AgentTool = {
  name: 'kanbanLogWorkOnTask',
  description: 'Log a work entry on a Kanban task. This appends a message to the task\'s worklog.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The ID of the task to log work on' },
      message: { type: 'string', description: 'The worklog message to append' },
    },
    required: ['taskId', 'message'],
  },
  run: async (input: { taskId: string; message: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    try {
      const task: KanbanTask = await kanbanService.kanbanLogWorkOnTask(input.taskId, input.message, meta?.workspaceId)
      return {
        summary: `Logged work on task "${task.title}": ${input.message}`,
        task,
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  },
}
