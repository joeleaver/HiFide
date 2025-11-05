import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'
import type { KanbanTask, KanbanStatus } from '../../store'

const statusEnum = z.enum(['backlog', 'todo', 'inProgress', 'done'])

const inputSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: statusEnum.optional(),
  epicId: z.string().min(1).optional().nullable(),
  assignees: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
})

export const kanbanUpdateTaskTool: AgentTool = {
  name: 'kanban:updateTask',
  description: 'Update a task on the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanUpdateTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const patch: Partial<KanbanTask> & { status?: KanbanStatus } = {}
    if (params.title !== undefined) patch.title = params.title
    if (params.description !== undefined) patch.description = params.description
    if (params.status !== undefined) patch.status = params.status
    if (params.epicId !== undefined) patch.epicId = params.epicId ?? null
    if (params.assignees !== undefined) patch.assignees = params.assignees
    if (params.tags !== undefined) patch.tags = params.tags

    const updated: KanbanTask | null = await state.kanbanUpdateTask(params.taskId, patch)
    if (!updated) {
      throw new Error(`Failed to update task ${params.taskId}`)
    }

    yield {
      type: 'object',
      data: {
        summary: `Updated task "${updated.title}" (${updated.status}).`,
        task: updated,
      },
    }
  },
}
