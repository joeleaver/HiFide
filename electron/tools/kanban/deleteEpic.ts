import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'

export const kanbanDeleteEpicTool: AgentTool = {
  name: 'kanbanDeleteEpic',
  description: 'Delete an epic from the Kanban board (tasks referencing it will be unassigned).',
  parameters: {
    type: 'object',
    properties: { epicId: { type: 'string', minLength: 1 } },
    required: ['epicId'],
    additionalProperties: false,
  },
  run: async (input: { epicId: string }, meta?: any) => {
    const kanbanService = getKanbanService()

    const result = await kanbanService.kanbanDeleteEpic(input.epicId, meta?.workspaceId)
    if (!result?.ok) {
      throw new Error(`Failed to delete epic ${input.epicId}`)
    }

    return {
      summary: `Deleted epic ${input.epicId}.`,
      deleted: { epicId: input.epicId },
    }
  },
}
