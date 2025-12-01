import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
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
  run: async (input: { name: string; color?: string; description?: string }, meta?: any) => {
    const kanbanService = getKanbanService()

    const epic: KanbanEpic = await kanbanService.kanbanCreateEpic({
      workspaceId: meta?.workspaceId,
      name: input.name,
      color: input.color || '#3b82f6',
      description: input.description || '',
    })

    return {
      summary: `Created epic "${epic.name}".`,
      epic,
    }
  },
}
