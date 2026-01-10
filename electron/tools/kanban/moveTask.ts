import type { AgentTool } from '../../providers/provider'
import type { KanbanStatus } from '../../store'
import { getKanbanService } from '../../services/index.js'

export const kanbanMoveTaskTool: AgentTool = {
  name: 'kanbanMoveTask',
  description: 'Move a task to a different status column.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'] },
    },
    required: ['taskId', 'status'],
  },
  run: async (input: { taskId: string; status: KanbanStatus }, meta?: any) => {
    const kanbanService = getKanbanService()
    const result = await kanbanService.kanbanMoveTask({
      taskId: input.taskId,
      toStatus: input.status,
      toIndex: 0,
      workspaceId: meta?.workspaceId,
    })
    if (!result?.ok) throw new Error(`Failed to move task ${input.taskId}`)
    return { ok: true, id: input.taskId, status: input.status }
  },
}
