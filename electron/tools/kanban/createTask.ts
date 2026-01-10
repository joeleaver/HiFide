import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanCreateTaskTool: AgentTool = {
  name: 'kanbanCreateTask',
  description: 'Create a Kanban task.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress'] },
      epicId: { type: 'string' },
    },
    required: ['title'],
  },
  run: async (input: { title: string; description?: string; status?: KanbanStatus; epicId?: string }, meta?: any) => {
    const kanbanService = getKanbanService()
    const task: KanbanTask = await kanbanService.kanbanCreateTask({
      workspaceId: meta?.workspaceId,
      title: input.title,
      status: input.status ?? 'backlog',
      epicId: input.epicId ?? null,
      description: input.description,
    })
    return { ok: true, id: task.id, title: task.title, status: task.status }
  },
}
