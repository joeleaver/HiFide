import type { AgentTool } from '../../providers/provider'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanCreateTaskTool: AgentTool = {
  name: 'kanbanCreateTask',
  description: 'Create a new task on the Kanban board.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, description: 'Task title' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'], default: 'backlog' },
      epicId: { type: 'string' },
      assignees: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title'],
    additionalProperties: false,
  },
  run: async (input: { title: string; description?: string; status?: KanbanStatus; epicId?: string | null; assignees?: string[]; tags?: string[] }) => {
    const { useMainStore } = await import('../../store')
    const state = useMainStore.getState() as any

    if (typeof state.kanbanCreateTask !== 'function') {
      throw new Error('Kanban store is not initialized')
    }

    const task: KanbanTask | null = await state.kanbanCreateTask({
      title: input.title,
      status: input.status ?? 'backlog',
      epicId: input.epicId ?? null,
      description: input.description,
      assignees: input.assignees,
      tags: input.tags,
    })

    if (!task) {
      throw new Error('Failed to create task')
    }

    return {
      summary: `Created task "${task.title}" in ${task.status}.`,
      task,
    }
  },
}
