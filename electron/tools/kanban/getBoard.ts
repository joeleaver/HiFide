import type { AgentTool } from '../../providers/provider'
import type { KanbanBoard, KanbanStatus, KanbanTask } from '../../store'
import { readKanbanBoard } from '../../store/utils/kanban.js'

async function ensureBoardLoadedFor(workspaceId?: string): Promise<KanbanBoard> {
  if (!workspaceId) {
    throw new Error('workspaceId is required for kanban operations')
  }

  // Always read directly from disk for the specified workspace to avoid single-tenant store crosstalk
  return await readKanbanBoard(workspaceId)
}

type FilterParams = { status?: KanbanStatus; epicId?: string }

function filterArchivedTasks(board: KanbanBoard): KanbanBoard {
  const visibleTasks = board.tasks.filter((task) => !task.archived)

  if (visibleTasks.length === board.tasks.length) {
    return board
  }

  return { ...board, tasks: visibleTasks }
}

function filterDoneTasks(board: KanbanBoard): KanbanBoard {
  const activeTasks = board.tasks.filter((task) => task.status !== 'done')

  if (activeTasks.length === board.tasks.length) {
    return board
  }

  return { ...board, tasks: activeTasks }
}

function filterTasksByParams(tasks: KanbanTask[], params: FilterParams): KanbanTask[] {
  return tasks.filter((task) => {
    if (params.status && task.status !== params.status) return false
    if (params.epicId && task.epicId !== params.epicId) return false
    return true
  })
}

function groupTasksByStatus(tasks: KanbanTask[]): Record<KanbanStatus, KanbanTask[]> {
  return {
    backlog: tasks.filter((t) => t.status === 'backlog'),
    todo: tasks.filter((t) => t.status === 'todo'),
    inProgress: tasks.filter((t) => t.status === 'inProgress'),
    done: tasks.filter((t) => t.status === 'done'),
  }
}

export const kanbanGetBoardTool: AgentTool = {
  name: 'kanbanGetBoard',
  description: 'Retrieve the Kanban board, optionally filtered by status or epic.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['backlog', 'todo', 'inProgress', 'done'], description: 'Filter by task status' },
      epicId: { type: 'string', description: 'Filter by epic ID' },
    },
  },
  run: async (input: { status?: KanbanStatus; epicId?: string }, meta?: any) => {
    const rawBoard = await ensureBoardLoadedFor(meta?.workspaceId)
    const board = filterDoneTasks(filterArchivedTasks(rawBoard))

    const params: FilterParams = { status: input?.status, epicId: input?.epicId }

    const tasks = filterTasksByParams(board.tasks, params)

    const byStatus = groupTasksByStatus(tasks)
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
