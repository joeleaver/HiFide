import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'

export const kanbanDeleteTaskTool: AgentTool = {
  name: 'kanbanDeleteTask',
  description: 'Delete a task from the Kanban board.',
  parameters: {
    type: 'object',
    properties: { taskId: { type: 'string', minLength: 1 } },
    required: ['taskId'],
    additionalProperties: false,
  },
  run: async (input: { taskId: string }, meta?: any) => {
    const kanbanService = getKanbanService()

    const result = await kanbanService.kanbanDeleteTask(input.taskId, meta?.workspaceId)
    if (!result?.ok) {
      throw new Error(`Failed to delete task ${input.taskId}`)
    }

    return {
      summary: `Deleted task ${input.taskId}.`,
      deleted: { taskId: input.taskId },
    }
  },
}
