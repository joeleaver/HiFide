import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'

const statusEnum = z.enum(['backlog', 'todo', 'inProgress', 'done'])

const inputSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  status: statusEnum,
  index: z.number().int().min(0).default(0),
})

export const kanbanMoveTaskTool: AgentTool = {
  name: 'kanban:moveTask',
  description: 'Move a task to a different column and position on the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanMoveTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const result = await state.kanbanMoveTask({
      taskId: params.taskId,
      toStatus: params.status,
      toIndex: params.index,
    })

    if (!result?.ok) {
      throw new Error(`Failed to move task ${params.taskId}`)
    }

    yield {
      type: 'object',
      data: {
        summary: `Moved task ${params.taskId} to ${params.status} at index ${params.index}.`,
      },
    }
  },
}
