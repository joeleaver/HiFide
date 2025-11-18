import type { AgentTool } from '../../providers/provider'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanUpdateTaskTool: AgentTool = {
  name: 'kanbanUpdateTask',
  description: 'Update a task on the Kanban board.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'] },
      epicId: { type: 'string' },
      assignees: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  run: async (input: { taskId: string; title?: string; description?: string; status?: KanbanStatus; epicId?: string | null; assignees?: string[]; tags?: string[] }) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanUpdateTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const patch: Partial<KanbanTask> & { status?: KanbanStatus } = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.description !== undefined) patch.description = input.description
    if (input.status !== undefined) patch.status = input.status
    if (input.epicId !== undefined) patch.epicId = input.epicId ?? null
    if (input.assignees !== undefined) patch.assignees = input.assignees
    if (input.tags !== undefined) patch.tags = input.tags

    const updated: KanbanTask | null = await state.kanbanUpdateTask(input.taskId, patch)
    if (!updated) {
      throw new Error(`Failed to update task ${input.taskId}`)
    }

    return {
      summary: `Updated task "${updated.title}" (${updated.status}).`,
      task: updated,
    }
  },
}
