import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanEpic } from '../../store'

export const kanbanCreateEpicTool: AgentTool = {
  name: 'kanbanCreateEpic',
  description: 'Create a Kanban epic.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      color: { type: 'string' },
    },
    required: ['name'],
  },
  run: async (input: { name: string; color?: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    const epic: KanbanEpic = await kanbanService.kanbanCreateEpic({
      workspaceId: meta?.workspaceId,
      name: input.name,
      color: input.color || '#3b82f6',
      description: '',
    })
    return { ok: true, id: epic.id, name: epic.name }
  },
}
