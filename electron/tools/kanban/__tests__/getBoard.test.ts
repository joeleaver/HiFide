import type { KanbanBoard, KanbanTask } from '../../../store'
import { kanbanGetBoardTool } from '../getBoard'
import { readKanbanBoard } from '../../../store/utils/kanban'

jest.mock('../../../store/utils/kanban', () => ({
  readKanbanBoard: jest.fn(),
}))

const mockedRead = readKanbanBoard as jest.MockedFunction<typeof readKanbanBoard>

const DEFAULT_COLUMNS: KanbanBoard['columns'] = ['backlog', 'todo', 'inProgress', 'done']

let taskCounter = 0
const buildTask = (overrides: Partial<KanbanTask> = {}): KanbanTask => ({
  id: overrides.id ?? `task-${taskCounter++}`,
  title: overrides.title ?? 'Task',
  status: overrides.status ?? 'todo',
  order: overrides.order ?? 0,
  description: overrides.description,
  epicId: overrides.epicId,
  assignees: overrides.assignees,
  tags: overrides.tags,
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
  archived: overrides.archived,
  archivedAt: overrides.archivedAt,
})

const buildBoard = (tasks: KanbanTask[]): KanbanBoard => ({
  version: 1,
  columns: DEFAULT_COLUMNS,
  epics: [],
  tasks,
})

describe('kanbanGetBoardTool', () => {
  const workspaceId = 'workspace-test'

  beforeEach(() => {
    mockedRead.mockReset()
    taskCounter = 0
  })

  it('removes archived tasks from the board snapshot and derived aggregates', async () => {
    mockedRead.mockResolvedValue(
      buildBoard([
        buildTask({ id: 'active', status: 'todo', order: 0 }),
        buildTask({ id: 'archived', status: 'todo', order: 1, archived: true, archivedAt: 123 }),
      ]),
    )

    const result = await kanbanGetBoardTool.run({}, { workspaceId })

    expect(result.board.tasks).toHaveLength(1)
    expect(result.board.tasks[0].id).toBe('active')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe('active')
    expect(result.byStatus.todo).toHaveLength(1)
    expect(result.counts.todo).toBe(1)
  })

  it('never returns done tasks, even when additional filters are provided', async () => {
    mockedRead.mockResolvedValue(
      buildBoard([
        buildTask({ id: 'done-visible', status: 'done', order: 0 }),
        buildTask({ id: 'done-archived', status: 'done', order: 1, archived: true }),
        buildTask({ id: 'todo-visible', status: 'todo', order: 2 }),
      ]),
    )

    const result = await kanbanGetBoardTool.run({ status: 'done' }, { workspaceId })

    expect(result.board.tasks.map((t: KanbanTask) => t.id)).toEqual(['todo-visible'])
    expect(result.tasks).toHaveLength(0)
    expect(result.byStatus.done).toHaveLength(0)
    expect(result.counts.done).toBe(0)
  })
})
