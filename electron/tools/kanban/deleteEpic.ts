import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'

export const kanbanDeleteEpicTool: AgentTool = {
  name: 'kanbanDeleteEpic',
  description: 'Delete a Kanban epic.',
  parameters: {
    type: 'object',
    properties: { epicId: { type: 'string' } },
    required: ['epicId'],
  },
  run: async (input: { epicId: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    const result = await kanbanService.kanbanDeleteEpic(input.epicId, meta?.workspaceId)
    if (!result?.ok) throw new Error(`Failed to delete epic ${input.epicId}`)
    return { ok: true, deleted: input.epicId }
  },
}
