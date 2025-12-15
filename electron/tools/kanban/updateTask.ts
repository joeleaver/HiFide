import type { AgentTool } from '../../providers/provider'
import { getKanbanService } from '../../services/index.js'
import type { KanbanTask, KanbanStatus } from '../../store'

export const kanbanUpdateTaskTool: AgentTool = {
  name: 'kanbanUpdateTask',
  description: 'Update a task on the Kanban board, including its linked Knowledge Base article.',
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
      kbArticleId: { type: 'string', description: 'Knowledge Base article ID to associate with the task' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  run: async (input: { taskId: string; title?: string; description?: string; status?: KanbanStatus; epicId?: string | null; assignees?: string[]; tags?: string[]; kbArticleId?: string | null }, meta?: any) => {
    const kanbanService = getKanbanService()

    const patch: Partial<KanbanTask> & { status?: KanbanStatus } = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.description !== undefined) patch.description = input.description
    if (input.status !== undefined) patch.status = input.status
    if (input.epicId !== undefined) patch.epicId = input.epicId ?? null
    if (input.assignees !== undefined) patch.assignees = input.assignees
    if (input.tags !== undefined) patch.tags = input.tags
    if (input.kbArticleId !== undefined) patch.kbArticleId = input.kbArticleId ?? null

    const updated: KanbanTask = await kanbanService.kanbanUpdateTask(input.taskId, patch, meta?.workspaceId)

    return {
      summary: `Updated task "${updated.title}" (${updated.status}).`,
      task: updated,
    }
  },
}
