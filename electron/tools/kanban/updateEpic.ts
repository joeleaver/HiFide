import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanEpic } from '../../store'

export const kanbanUpdateEpicTool: AgentTool = {
  name: 'kanbanUpdateEpic',
  description: 'Update a Kanban epic.',
  parameters: {
    type: 'object',
    properties: {
      epicId: { type: 'string' },
      name: { type: 'string' },
      color: { type: 'string' },
    },
    required: ['epicId'],
  },
  run: async (input: { epicId: string; name?: string; color?: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    const patch: Partial<KanbanEpic> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.color !== undefined) patch.color = input.color
    const epic: KanbanEpic = await kanbanService.kanbanUpdateEpic(input.epicId, patch, meta?.workspaceId)
    return { ok: true, id: epic.id, name: epic.name }
  },
}
