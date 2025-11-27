import type { AgentTool } from '../../providers/provider'

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
    const { ServiceRegistry } = await import('../../services/base/ServiceRegistry.js')
    const kanbanService = ServiceRegistry.get<any>('kanban')

    if (!kanbanService) {
      throw new Error('Kanban service is not initialized')
    }

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
