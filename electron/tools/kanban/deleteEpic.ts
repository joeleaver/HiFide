import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'

const inputSchema = z.object({
  epicId: z.string().min(1, 'epicId is required'),
})

export const kanbanDeleteEpicTool: AgentTool = {
  name: 'kanban:deleteEpic',
  description: 'Delete an epic from the Kanban board (tasks referencing it will be unassigned).',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanDeleteEpic !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const result = await state.kanbanDeleteEpic(params.epicId)
    if (!result?.ok) {
      throw new Error(`Failed to delete epic ${params.epicId}`)
    }

    yield {
      type: 'object',
      data: {
        summary: `Deleted epic ${params.epicId}.`,
      },
    }
  },
}
