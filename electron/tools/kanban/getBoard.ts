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

function groupTasksByStatus(tasks: KanbanTask[]): Record<KanbanStatus, KanbanTask[]> {
  return {
    backlog: tasks.filter((t) => t.status === 'backlog'),
    todo: tasks.filter((t) => t.status === 'todo'),
    inProgress: tasks.filter((t) => t.status === 'inProgress'),
    done: tasks.filter((t) => t.status === 'done'),
  }
}

/** Minify a task to essential fields only */
function minifyTask(task: KanbanTask): Record<string, any> {
  const mini: Record<string, any> = {
    id: task.id,
    title: task.title,
  }
  if (task.description) mini.description = task.description
  if (task.epicId) mini.epicId = task.epicId
  return mini
}

export const kanbanGetBoardTool: AgentTool = {
  name: 'kanbanGetBoard',
  description: 'Retrieve active Kanban tasks grouped by status (backlog, todo, inProgress). Done tasks are excluded.',
  parameters: {
    type: 'object',
    properties: {
      epicId: { type: 'string', description: 'Filter by epic ID' },
    },
  },
  run: async (input: { epicId?: string }, meta?: any) => {
    const rawBoard = await ensureBoardLoadedFor(meta?.workspaceId)
    const board = filterDoneTasks(filterArchivedTasks(rawBoard))

    let tasks = board.tasks
    if (input?.epicId) {
      tasks = tasks.filter(t => t.epicId === input.epicId)
    }

    const byStatus = groupTasksByStatus(tasks)

    // Return minimal object with only active statuses
    return {
      backlog: byStatus.backlog.map(minifyTask),
      todo: byStatus.todo.map(minifyTask),
      inProgress: byStatus.inProgress.map(minifyTask),
    }
  },
}
