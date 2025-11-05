import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'
import type { KanbanTask } from '../../store'

const statusEnum = z.enum(['backlog', 'todo', 'inProgress', 'done'])

const inputSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  status: statusEnum.default('backlog'),
  epicId: z.string().min(1).optional().nullable(),
  assignees: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
})

export const kanbanCreateTaskTool: AgentTool = {
  name: 'kanban:createTask',
  description: 'Create a new task on the Kanban board.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanCreateTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const task: KanbanTask | null = await state.kanbanCreateTask({
      title: params.title,
      status: params.status,
      epicId: params.epicId ?? null,
      description: params.description,
      assignees: params.assignees,
      tags: params.tags,
    })

    if (!task) {
      throw new Error('Failed to create task')
    }

    yield {
      type: 'object',
      data: {
        summary: `Created task "${task.title}" in ${task.status}.`,
        task,
      },
    }
  },
}
