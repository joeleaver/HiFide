import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanEpic } from '../../store'

export const kanbanUpdateEpicTool: AgentTool = {
  name: 'kanbanUpdateEpic',
  description: 'Update an existing epic on the Kanban board.',
  parameters: {
    type: 'object',
    properties: {
      epicId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      color: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['epicId'],
    additionalProperties: false,
  },
  run: async (input: { epicId: string; name?: string; color?: string; description?: string | null }, meta?: any) => {
    const kanbanService = getKanbanService()

    const patch: Partial<KanbanEpic> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.color !== undefined) patch.color = input.color
    if (input.description !== undefined) patch.description = input.description ?? undefined

    const epic: KanbanEpic = await kanbanService.kanbanUpdateEpic(input.epicId, patch, meta?.workspaceId)

    return {
      summary: `Updated epic "${epic.name}".`,
      epic,
    }
  },
}
