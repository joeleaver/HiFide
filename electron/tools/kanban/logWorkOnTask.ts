import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'

export const kanbanLogWorkOnTaskTool: AgentTool = {
  name: 'kanbanLogWorkOnTask',
  description: 'Append a worklog entry to a task.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['taskId', 'message'],
  },
  run: async (input: { taskId: string; message: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    await kanbanService.kanbanLogWorkOnTask(input.taskId, input.message, meta?.workspaceId)
    return { ok: true, taskId: input.taskId }
  },
}
