import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'
import type { KanbanEpic } from '../../store'

const inputSchema = z.object({
  epicId: z.string().min(1, 'epicId is required'),
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  description: z.string().optional().nullable(),
})

export const kanbanUpdateEpicTool: AgentTool = {
  name: 'kanban:updateEpic',
  description: 'Update an existing epic on the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanUpdateEpic !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const patch: Partial<KanbanEpic> = {}
    if (params.name !== undefined) patch.name = params.name
    if (params.color !== undefined) patch.color = params.color
    if (params.description !== undefined) patch.description = params.description ?? undefined

    const epic: KanbanEpic | null = await state.kanbanUpdateEpic(params.epicId, patch)
    if (!epic) {
      throw new Error(`Failed to update epic ${params.epicId}`)
    }

    yield {
      type: 'object',
      data: {
        summary: `Updated epic "${epic.name}".`,
        epic,
      },
    }
  },
}
