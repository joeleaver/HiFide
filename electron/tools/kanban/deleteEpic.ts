import type { AgentTool } from '../../providers/provider'

export const kanbanDeleteEpicTool: AgentTool = {
  name: 'kanbanDeleteEpic',
  description: 'Delete an epic from the Kanban board (tasks referencing it will be unassigned).',
  parameters: {
    type: 'object',
    properties: { epicId: { type: 'string', minLength: 1 } },
    required: ['epicId'],
    additionalProperties: false,
  },
  run: async (input: { epicId: string }) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanDeleteEpic !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const result = await state.kanbanDeleteEpic(input.epicId)
    if (!result?.ok) {
      throw new Error(`Failed to delete epic ${input.epicId}`)
    }

    return {
      summary: `Deleted epic ${input.epicId}.`,
      deleted: { epicId: input.epicId },
    }
  },
}
