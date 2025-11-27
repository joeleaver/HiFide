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
  run: async (input: { epicId: string }, meta?: any) => {
    const { ServiceRegistry } = await import('../../services/base/ServiceRegistry.js')
    const kanbanService = ServiceRegistry.get<any>('kanban')

    if (!kanbanService) {
      throw new Error('Kanban service is not initialized')
    }

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
