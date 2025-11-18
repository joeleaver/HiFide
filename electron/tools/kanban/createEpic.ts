import type { AgentTool } from '../../providers/provider'
import type { KanbanEpic } from '../../store'

export const kanbanCreateEpicTool: AgentTool = {
  name: 'kanbanCreateEpic',
  description: 'Create a new epic on the Kanban board.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      color: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  run: async (input: { name: string; color?: string; description?: string }) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanCreateEpic !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const epic: KanbanEpic | null = await state.kanbanCreateEpic({
      name: input.name,
      color: input.color,
      description: input.description,
    })

    if (!epic) {
      throw new Error('Failed to create epic')
    }

    return {
      summary: `Created epic "${epic.name}".`,
      epic,
    }
  },
}
