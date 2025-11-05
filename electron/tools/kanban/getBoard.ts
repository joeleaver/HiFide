import { z } from 'zod'
import type { AgentTool } from '../../providers/provider'
import type { KanbanBoard, KanbanStatus } from '../../store'

const statusEnum = z.enum(['backlog', 'todo', 'inProgress', 'done'])

const inputSchema = z.object({
  status: statusEnum.optional(),
  epicId: z.string().min(1).optional(),
})

async function ensureBoardLoaded(): Promise<KanbanBoard> {
  const { useMainStore } = await import('../../store')
  const state = useMainStore.getState() as any

  if (!state.kanbanBoard && typeof state.kanbanLoad === 'function') {
    await state.kanbanLoad()
  }

  const refreshed = useMainStore.getState() as any
  if (!refreshed.kanbanBoard) {
    throw new Error('Kanban board is not available')
  }
  return refreshed.kanbanBoard as KanbanBoard
}

export const kanbanGetBoardTool: AgentTool = {
  name: 'kanban:getBoard',
  description: 'Retrieve the Kanban board, optionally filtered by status or epic.',
  parameters: inputSchema,
  async *run({ input }) {
    const params = inputSchema.parse(input ?? {})
    const board = await ensureBoardLoaded()

    const tasks = board.tasks.filter((task) => {
      if (params.status && task.status !== (params.status as KanbanStatus)) {
        return false
      }
      if (params.epicId && task.epicId !== params.epicId) {
        return false
      }
      return true
    })

    yield {
      type: 'object',
      data: {
        summary: `Returned Kanban board with ${tasks.length} task(s).`,
        board,
        tasks,
        filter: params,
      },
    }
  },
}
