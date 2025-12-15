import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanCreateTaskTool: AgentTool = {
  name: 'kanbanCreateTask',
  description: 'Create a new task on the Kanban board (optionally linking a Knowledge Base article via kbArticleId).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, description: 'Task title' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'], default: 'backlog' },
      epicId: { type: 'string' },
      assignees: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
      kbArticleId: { type: 'string', description: 'Knowledge Base article ID to link to the task' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  run: async (input: { title: string; description?: string; status?: KanbanStatus; epicId?: string | null; assignees?: string[]; tags?: string[]; kbArticleId?: string | null }, meta?: any) => {
    const kanbanService = getKanbanService()

    const task: KanbanTask = await kanbanService.kanbanCreateTask({
      workspaceId: meta?.workspaceId,
      title: input.title,
      status: input.status ?? 'backlog',
      epicId: input.epicId ?? null,
      description: input.description,
      assignees: input.assignees,
      tags: input.tags,
      kbArticleId: input.kbArticleId ?? null,
    })

    return {
      summary: `Created task "${task.title}" in ${task.status}.`,
      task,
    }
  },
}
