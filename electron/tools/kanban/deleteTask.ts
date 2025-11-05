import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'

const inputSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
})

export const kanbanDeleteTaskTool: AgentTool = {
  name: 'kanban:deleteTask',
  description: 'Delete a task from the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanDeleteTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const result = await state.kanbanDeleteTask(params.taskId)
    if (!result?.ok) {
      throw new Error(`Failed to delete task ${params.taskId}`)
    }

    yield {
      type: 'object',
      data: {
        summary: `Deleted task ${params.taskId}.`,
      },
    }
  },
}
