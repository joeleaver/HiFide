import type { AgentTool } from '../../providers/provider'
import type { KanbanStatus } from '../../store'

export const kanbanMoveTaskTool: AgentTool = {
  name: 'kanbanMoveTask',
  description: 'Move a task to a different column and position on the Kanban board.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'] },
      index: { type: 'integer', minimum: 0, default: 0 },
    },
    required: ['taskId', 'status'],
    additionalProperties: false,
  },
  run: async (input: { taskId: string; status: KanbanStatus; index?: number }, meta?: any) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanMoveTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const idx = typeof input.index === 'number' && input.index >= 0 ? input.index : 0

    const result = await state.kanbanMoveTask({
      taskId: input.taskId,
      toStatus: input.status,
      toIndex: idx,
      workspaceId: meta?.workspaceId,
    })

    if (!result?.ok) {
      throw new Error(`Failed to move task ${input.taskId}`)
    }

    return {
      summary: `Moved task ${input.taskId} to ${input.status} at index ${idx}.`,
      task: result.task || null,
    }
  },
}
