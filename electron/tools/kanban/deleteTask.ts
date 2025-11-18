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
  run: async (input: { taskId: string }) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanDeleteTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const result = await state.kanbanDeleteTask(input.taskId)
    if (!result?.ok) {
      throw new Error(`Failed to delete task ${input.taskId}`)
    }

    return {
      summary: `Deleted task ${input.taskId}.`,
      deleted: { taskId: input.taskId },
    }
  },
}
