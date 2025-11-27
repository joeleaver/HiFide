import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { KanbanBoard, KanbanEpic, KanbanStatus, KanbanTask } from '../types'

const KANBAN_DIR = path.join('.hifide-public', 'kanban')
const KANBAN_FILE = 'board.json'

export const KANBAN_STATUSES: KanbanStatus[] = ['backlog', 'todo', 'inProgress', 'done']

const statusEnum = z.enum(KANBAN_STATUSES)

const KanbanEpicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const KanbanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: statusEnum,
  order: z.number().int().nonnegative(),
  description: z.string().optional(),
  epicId: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archived: z.boolean().optional(),
  archivedAt: z.number().int().nonnegative().optional(),
})

const KanbanBoardSchema = z.object({
  version: z.number().int().min(1),
  columns: z.array(statusEnum),
  epics: z.array(KanbanEpicSchema),
  tasks: z.array(KanbanTaskSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

type ParsedKanbanBoard = z.infer<typeof KanbanBoardSchema>

const orderSorter = (a: KanbanTask, b: KanbanTask) => a.order - b.order

function resolveBoardPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, KANBAN_DIR, KANBAN_FILE)
}

export async function ensureKanbanDirectory(workspaceRoot: string): Promise<string> {
  const dir = path.join(workspaceRoot, KANBAN_DIR)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function normalizeEpic(epic: KanbanEpic): KanbanEpic {
  return {
    ...epic,
    color: epic.color ?? '#5C7AEA',
    description: epic.description ?? '',
  }
}

function normalizeTask(task: KanbanTask): KanbanTask {
  return {
    ...task,
    description: task.description ?? '',
    epicId: task.epicId ?? null,
    assignees: task.assignees ?? [],
    tags: task.tags ?? [],
    archived: task.archived ?? false,
    archivedAt: task.archivedAt,
  }
}

function sortAndIndexTasks(board: KanbanBoard): KanbanBoard {
  const byStatus: Record<KanbanStatus, KanbanTask[]> = {
    backlog: [],
    todo: [],
    inProgress: [],
    done: [],
  }

  board.tasks.forEach((task) => {
    byStatus[task.status].push(task)
  })

  const tasks: KanbanTask[] = []
  for (const status of KANBAN_STATUSES) {
    const ordered = byStatus[status]
      .sort(orderSorter)
      .map((task, index) => ({ ...task, order: index }))
    tasks.push(...ordered)
  }

  return { ...board, tasks }
}

export function reindexOrders(board: KanbanBoard): KanbanBoard {
  return sortAndIndexTasks(board)
}

export function applyTaskOrder(board: KanbanBoard, status: KanbanStatus, tasks: KanbanTask[]): KanbanBoard {
  const otherTasks = board.tasks.filter((task) => task.status !== status)
  const reindexed = tasks.map((task, index) => ({ ...task, status, order: index }))
  return sortAndIndexTasks({ ...board, tasks: [...otherTasks, ...reindexed] })
}

export function createDefaultKanbanBoard(): KanbanBoard {
  const timestamp = Date.now()
  const epicId = `epic-${randomUUID()}`

  return {
    version: 1,
    columns: [...KANBAN_STATUSES],
    epics: [
      {
        id: epicId,
        name: 'Foundations',
        color: '#5C7AEA',
        description: 'Initial Kanban epic. Create additional epics to organize work.',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    tasks: [
      {
        id: `task-${randomUUID()}`,
        title: 'Review Kanban board',
        status: 'backlog',
        order: 0,
        description: 'Open the Kanban view and move this card to understand drag & drop.',
        epicId,
        assignees: [],
        tags: ['kanban'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    metadata: {
      createdAt: timestamp,
    },
  }
}

function parseBoard(raw: ParsedKanbanBoard): KanbanBoard {
  const board: KanbanBoard = {
    version: raw.version,
    columns: raw.columns.length ? (raw.columns as KanbanStatus[]) : [...KANBAN_STATUSES],
    epics: raw.epics.map((epic) => normalizeEpic(epic as KanbanEpic)),
    tasks: raw.tasks.map((task) => normalizeTask(task as KanbanTask)),
    metadata: raw.metadata ?? {},
  }
  return sortAndIndexTasks(board)
}

export async function readKanbanBoard(workspaceRoot: string): Promise<KanbanBoard> {
  const boardPath = resolveBoardPath(workspaceRoot)
  try {
    const data = await fs.readFile(boardPath, 'utf8')
    const json = JSON.parse(data)
    const parsed = KanbanBoardSchema.parse(json)
    return parseBoard(parsed)
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const board = createDefaultKanbanBoard()
      await writeKanbanBoard(workspaceRoot, board)
      return board
    }
    throw error
  }
}

export async function writeKanbanBoard(workspaceRoot: string, board: KanbanBoard): Promise<void> {
  await ensureKanbanDirectory(workspaceRoot)
  const boardPath = resolveBoardPath(workspaceRoot)
  const normalized = sortAndIndexTasks({
    ...board,
    columns: board.columns.length ? board.columns : [...KANBAN_STATUSES],
    epics: board.epics.map(normalizeEpic),
    tasks: board.tasks.map(normalizeTask),
  })
  const payload = JSON.stringify(normalized, null, 2)

  // Atomic write: use unique temp file to prevent race conditions
  // Use timestamp + random to ensure uniqueness (same pattern as session persistence)
  const tmpPath = `${boardPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`

  await fs.writeFile(tmpPath, payload, 'utf8')
  await fs.rename(tmpPath, boardPath)
}

export function nextOrderForStatus(board: KanbanBoard, status: KanbanStatus): number {
  return board.tasks.filter((task) => task.status === status).length
}

/**
 * Debounced Kanban board saver
 *
 * Prevents concurrent writes to the same workspace's board.
 * Similar to DebouncedSessionSaver but for Kanban boards.
 */
class DebouncedKanbanSaver {
  private saveTimeouts = new Map<string, NodeJS.Timeout>()
  private activeSaves = new Map<string, Promise<void>>()
  private readonly debounceMs: number

  constructor(debounceMs = 300) {
    this.debounceMs = debounceMs
  }

  /**
   * Save a board with optional debouncing
   * Returns a Promise when immediate=true, void when debounced
   */
  save(workspaceRoot: string, board: KanbanBoard, immediate = false): Promise<void> | void {
    // Clear existing timeout for this workspace
    const existingTimeout = this.saveTimeouts.get(workspaceRoot)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.saveTimeouts.delete(workspaceRoot)
    }

    if (immediate) {
      // Immediate save - return Promise so caller can await
      return this.performSave(workspaceRoot, board)
    } else {
      // Debounced save - fire and forget
      const timeout = setTimeout(() => {
        this.performSave(workspaceRoot, board)
        this.saveTimeouts.delete(workspaceRoot)
      }, this.debounceMs)

      this.saveTimeouts.set(workspaceRoot, timeout)
    }
  }

  /**
   * Perform the actual save, preventing concurrent saves to the same workspace
   */
  private async performSave(workspaceRoot: string, board: KanbanBoard): Promise<void> {
    // Wait for any active save to complete
    const activeSave = this.activeSaves.get(workspaceRoot)
    if (activeSave) {
      await activeSave.catch(() => {
        // Ignore errors from previous save
      })
    }

    // Start new save
    const savePromise = writeKanbanBoard(workspaceRoot, board)
      .catch(e => {
        console.error('[kanban-persistence] Save failed:', e)
        throw e // Re-throw so caller can handle
      })
      .finally(() => {
        // Clean up active save tracking
        if (this.activeSaves.get(workspaceRoot) === savePromise) {
          this.activeSaves.delete(workspaceRoot)
        }
      })

    this.activeSaves.set(workspaceRoot, savePromise)
    await savePromise
  }

  /**
   * Cancel all pending saves
   */
  cancelAll(): void {
    for (const timeout of this.saveTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.saveTimeouts.clear()
  }
}

// Singleton instance
export const kanbanSaver = new DebouncedKanbanSaver(300)
