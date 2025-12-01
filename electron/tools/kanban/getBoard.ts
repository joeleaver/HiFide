import type { AgentTool } from '../../providers/provider'
import type { KanbanBoard, KanbanStatus } from '../../store'
import { readKanbanBoard } from '../../store/utils/kanban.js'

async function ensureBoardLoadedFor(workspaceId?: string): Promise<KanbanBoard> {
  if (!workspaceId) {
    throw new Error('workspaceId is required for kanban operations')
  }

  // Always read directly from disk for the specified workspace to avoid single-tenant store crosstalk
  return await readKanbanBoard(workspaceId)
}

export const kanbanGetBoardTool: AgentTool = {
  name: 'kanbanGetBoard',
  description: 'Retrieve the Kanban board, optionally filtered by status or epic.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'] },
      epicId: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  run: async (input: { status?: KanbanStatus; epicId?: string }, meta?: any) => {
    const board = await ensureBoardLoadedFor(meta?.workspaceId)

    const params = { status: input?.status, epicId: input?.epicId }

    const tasks = board.tasks.filter((task) => {
      if (params.status && task.status !== (params.status as KanbanStatus)) return false
      if (params.epicId && task.epicId !== params.epicId) return false
      return true
    })

    const byStatus: Record<KanbanStatus, typeof tasks> = {
      backlog: tasks.filter((t) => t.status === 'backlog'),
      todo: tasks.filter((t) => t.status === 'todo'),
      inProgress: tasks.filter((t) => t.status === 'inProgress'),
      done: tasks.filter((t) => t.status === 'done'),
    }
    const counts = {
      backlog: byStatus.backlog.length,
      todo: byStatus.todo.length,
      inProgress: byStatus.inProgress.length,
      done: byStatus.done.length,
    }

    return {
      summary: `Returned Kanban board with ${tasks.length} task(s).`,
      board,
      tasks,
      byStatus,
      counts,
      filter: params,
    }
  },
}
