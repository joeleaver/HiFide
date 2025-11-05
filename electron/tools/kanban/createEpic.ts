import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'
import type { KanbanEpic } from '../../store'

const inputSchema = z.object({
  name: z.string().min(1, 'Epic name is required'),
  color: z.string().optional(),
  description: z.string().optional(),
})

export const kanbanCreateEpicTool: AgentTool = {
  name: 'kanban:createEpic',
  description: 'Create a new epic on the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanCreateEpic !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const epic: KanbanEpic | null = await state.kanbanCreateEpic({
      name: params.name,
      color: params.color,
      description: params.description,
    })

    if (!epic) {
      throw new Error('Failed to create epic')
    }

    yield {
      type: 'object',
      data: {
        summary: `Created epic "${epic.name}".`,
        epic,
      },
    }
  },
}
