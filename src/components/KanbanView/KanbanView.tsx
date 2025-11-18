import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  useMantineTheme,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { IconPlus, IconEdit, IconTrash, IconColumns3, IconFolderPlus } from '@tabler/icons-react'

import { getBackendClient } from '../../lib/backend/bootstrap'
import type { KanbanEpic, KanbanStatus, KanbanTask, KanbanBoard } from '../../../electron/store/types'
import StreamingMarkdown from '../StreamingMarkdown'

const COLUMNS: { status: KanbanStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'To Do' },
  { status: 'inProgress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
]

type TaskModalState =
  | { mode: 'create'; status: KanbanStatus }
  | { mode: 'edit'; task: KanbanTask }

type EpicModalState =
  | { mode: 'create' }
  | { mode: 'edit'; epic: KanbanEpic }

type TaskFormValues = {
  title: string
  status: KanbanStatus
  epicId: string | null
  description: string
}

type EpicFormValues = {
  name: string
  color?: string
  description?: string
}

export default function KanbanView() {
  const theme = useMantineTheme()

  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const epics = board?.epics ?? []


  // Hydrate snapshot
  useEffect(() => {
    (async () => {
      try {
        const res: any = await getBackendClient()?.rpc('kanban.getBoard', {})
        if (res?.ok) {
          setBoard(res.board || null)
          setLoading(!!res.loading)
          setSaving(!!res.saving)
          setError(res.error || null)
        }
      } catch {}
    })()
  }, [])

  // Subscribe to live updates (attach even if backend connects later)
  useEffect(() => {
    let cancelled = false
    let off: (() => void) | undefined

    const attach = async () => {
      // Wait for client instance to exist
      let client = getBackendClient()
      while (!client && !cancelled) {
        await new Promise((r) => setTimeout(r, 150))
        client = getBackendClient()
      }
      if (cancelled || !client) return
      // Wait until connection is ready
      try { await (client as any).whenReady?.(5000) } catch {}
      if (cancelled) return
      off = client.subscribe('kanban.board.changed', (p: any) => {
        // Always reflect loading/saving/error promptly
        setLoading(!!p?.loading)
        setSaving(!!p?.saving)
        setError(p?.error || null)

        const nextBoard = p?.board || null
        const pending = pendingMoveRef.current

        // If we have a pending optimistic move, avoid clobbering it with a stale snapshot
        if (pending && nextBoard) {
          const moved = nextBoard.tasks?.find((t: any) => t.id === pending.taskId)
          if (moved && moved.status !== pending.toStatus) {
            // Stale server board (hasn't reflected our move yet) — keep optimistic UI
            return
          }
          // Server has caught up (or task missing). Clear pending and accept snapshot
          pendingMoveRef.current = null
        }

        setBoard(nextBoard)
      })
    }

    void attach()

    return () => { cancelled = true; try { off?.() } catch {} }
  }, [])

  const tasksByStatus = useMemo(() => {
    const grouped: Record<KanbanStatus, KanbanTask[]> = {
      backlog: [],
      todo: [],
      inProgress: [],
      done: [],
    }
    const tasks = board?.tasks ?? []

    for (const t of tasks) grouped[t.status].push(t)
    grouped.backlog.sort((a, b) => a.order - b.order)
    grouped.todo.sort((a, b) => a.order - b.order)
    grouped.inProgress.sort((a, b) => a.order - b.order)
    grouped.done.sort((a, b) => a.order - b.order)
    return grouped
  }, [board?.tasks])

  const epicMap = useMemo(() => {
    const map = new Map<string, KanbanEpic>()
    for (const epic of epics) {
      map.set(epic.id, epic)
    }
    return map
  }, [epics])

  const [taskModal, setTaskModal] = useState<TaskModalState | null>(null)
  const [epicModal, setEpicModal] = useState<EpicModalState | null>(null)
  const [epicDrawerOpen, setEpicDrawerOpen] = useState(false)

  const triedLoadRef = useRef(false)
  // Ensure we always kick a load once on mount (even if snapshot says loading)
  useEffect(() => {
    if (triedLoadRef.current) return
    triedLoadRef.current = true
    setLoading(true)
    ;(async () => {
      try {
        // Wait for backend client and connection to be ready
        let client = getBackendClient()
        while (!client) {
          await new Promise((r) => setTimeout(r, 150))
          client = getBackendClient()
        }
        try { await (client as any).whenReady?.(5000) } catch {}

        const res: any = await client!.rpc('kanban.load', {})
        if (!res?.ok) {
          notifications.show({ color: 'red', title: 'Kanban load failed', message: res?.error || 'Unable to load board' })
        } else {
          // Seed UI immediately from RPC response in case notifications are delayed
          if ('board' in res) {
            try { setBoard(res.board || null) } catch {}
          }
          try { setLoading(false) } catch {}
        }
      } catch (err) {
        console.error('[kanban] failed to load board:', err)
        notifications.show({ color: 'red', title: 'Kanban load failed', message: String(err) })
        try { setLoading(false) } catch {}
      }
    })()
  }, [])

  // Track an optimistic move to avoid overwriting with stale server snapshots
  const pendingMoveRef = useRef<{ taskId: string; toStatus: KanbanStatus; startedAt: number } | null>(null)

  // Produce an optimistic board for a drag result
  function buildOptimisticMove(prev: KanbanBoard, result: DropResult): KanbanBoard {
    const { draggableId: taskId, source, destination } = result
    if (!destination) return prev
    const fromStatus = source.droppableId as KanbanStatus
    const toStatus = destination.droppableId as KanbanStatus
    const fromIndex = source.index
    const toIndexRaw = destination.index

    const byStatus: Record<KanbanStatus, KanbanTask[]> = {
      backlog: [], todo: [], inProgress: [], done: []
    }
    for (const t of prev.tasks) byStatus[t.status].push(t)
    for (const k of Object.keys(byStatus) as KanbanStatus[]) byStatus[k].sort((a, b) => a.order - b.order)

    if (fromStatus === toStatus) {
      const list = [...byStatus[fromStatus]]
      if (fromIndex < 0 || fromIndex >= list.length) return prev
      const [removed] = list.splice(fromIndex, 1)
      const toIndex = Math.max(0, Math.min(toIndexRaw, list.length))
      list.splice(toIndex, 0, removed)
      const reindexed = list.map((t, i) => ({ ...t, order: i, updatedAt: t.id === taskId ? Date.now() : t.updatedAt }))
      const others = prev.tasks.filter((t) => t.status !== fromStatus)
      return { ...prev, tasks: [...others, ...reindexed] }
    } else {
      const src = [...byStatus[fromStatus]]
      if (fromIndex < 0 || fromIndex >= src.length) return prev
      const [removed] = src.splice(fromIndex, 1)
      const dst = [...byStatus[toStatus]]
      const toIndex = Math.max(0, Math.min(toIndexRaw, dst.length))
      dst.splice(toIndex, 0, { ...removed, status: toStatus })
      const reSrc = src.map((t, i) => ({ ...t, order: i }))
      const reDst = dst.map((t, i) => ({ ...t, status: toStatus, order: i, updatedAt: t.id === taskId ? Date.now() : t.updatedAt }))
      const others = prev.tasks.filter((t) => t.status !== fromStatus && t.status !== toStatus)
      return { ...prev, tasks: [...others, ...reSrc, ...reDst] }
    }
  }

  // If loading seems stuck without a board, fall back to showing unavailable UI instead of spinning forever
  useEffect(() => {
    if (loading && !board) {
      const t = setTimeout(() => {
        try { setLoading(false) } catch {}
      }, 4000)
      return () => clearTimeout(t)
    }
  }, [loading, board])

  useEffect(() => {
    if (error) {
      notifications.show({ color: 'red', title: 'Kanban error', message: error })
    }
  }, [error])

  const handleDragEnd = async (result: DropResult) => {
    const destination = result.destination
    const source = result.source
    if (!destination || !board) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    // Optimistically update UI
    const prev = board
    const optimistic = buildOptimisticMove(prev, result)
    if (optimistic !== prev) {
      pendingMoveRef.current = {
        taskId: result.draggableId,
        toStatus: destination.droppableId as KanbanStatus,
        startedAt: Date.now(),
      }
      setBoard(optimistic)
    }

    try {
      const client = getBackendClient()
      const res: any = await client?.rpc('kanban.moveTask', {
        taskId: result.draggableId,
        toStatus: destination.droppableId as KanbanStatus,
        toIndex: destination.index,
      })
      if (!res?.ok) throw new Error('Move rejected')
    } catch (err) {
      // Roll back on failure
      try { setBoard(prev) } catch {}
      pendingMoveRef.current = null
      console.error('[kanban] move failed:', err)
      notifications.show({ color: 'red', title: 'Move failed', message: 'Unable to move task. Please try again.' })
    }
  }

  const openCreateTask = (status: KanbanStatus) => setTaskModal({ mode: 'create', status })
  const openEditTask = (task: KanbanTask) => setTaskModal({ mode: 'edit', task })
  const closeTaskModal = () => setTaskModal(null)

  const openCreateEpic = () => setEpicModal({ mode: 'create' })
  const openEditEpic = (epic: KanbanEpic) => setEpicModal({ mode: 'edit', epic })
  const closeEpicModal = () => setEpicModal(null)

  const handleDeleteTask = async (task: KanbanTask) => {
    const confirmed = window.confirm(`Delete task "${task.title}"?`)
    if (!confirmed) return

    try {
      const res: any = await getBackendClient()?.rpc('kanban.deleteTask', { taskId: task.id })
      if (!res?.ok) throw new Error('Delete rejected')
      notifications.show({ color: 'green', title: 'Task deleted', message: 'The task was removed.' })
    } catch (err) {
      console.error('[kanban] delete failed:', err)
      notifications.show({ color: 'red', title: 'Delete failed', message: String(err) })
    }
  }

  const handleSubmitTask = async (values: TaskFormValues, existingId?: string) => {
    try {
      if (existingId) {
        const res: any = await getBackendClient()?.rpc('kanban.updateTask', {
          taskId: existingId,
          patch: {
            title: values.title,
            status: values.status,
            epicId: values.epicId,
            description: values.description,
          }
        })
        if (!res?.ok || !res.task) throw new Error('Update rejected')
        notifications.show({ color: 'green', title: 'Task updated', message: `Saved "${values.title}".` })
      } else {
        const res: any = await getBackendClient()?.rpc('kanban.createTask', {
          input: {
            title: values.title,
            status: values.status,
            epicId: values.epicId,
            description: values.description,
          }
        })
        if (!res?.ok || !res.task) throw new Error('Create rejected')
        notifications.show({ color: 'green', title: 'Task created', message: `Added "${values.title}" to the board.` })
      }
      closeTaskModal()
    } catch (err) {
      console.error('[kanban] save failed:', err)
      notifications.show({ color: 'red', title: 'Save failed', message: String(err) })
    }
  }


  const handleSubmitEpic = async (values: EpicFormValues, existingId?: string) => {
    try {
      if (existingId) {
        const res: any = await getBackendClient()?.rpc('kanban.updateEpic', {
          epicId: existingId,
          patch: {
            name: values.name,
            color: values.color?.trim() || undefined,
            description: values.description?.trim() || undefined,
          }
        })
        if (!res?.ok || !res.epic) throw new Error('Update rejected')
        notifications.show({ color: 'green', title: 'Epic updated', message: `Updated "${values.name}".` })
      } else {
        const res: any = await getBackendClient()?.rpc('kanban.createEpic', {
          input: {
            name: values.name,
            color: values.color?.trim() || undefined,
            description: values.description?.trim() || undefined,
          }
        })
        if (!res?.ok || !res.epic) throw new Error('Create rejected')
        notifications.show({ color: 'green', title: 'Epic created', message: `Created epic "${values.name}".` })
      }
      closeEpicModal()
    } catch (err) {
      console.error('[kanban] epic save failed:', err)
      notifications.show({ color: 'red', title: 'Save failed', message: String(err) })
    }
  }


  const handleDeleteEpic = async (epic: KanbanEpic) => {
    const confirmed = window.confirm(`Delete epic "${epic.name}"? Tasks will be unassigned.`)
    if (!confirmed) return

    try {
      const res: any = await getBackendClient()?.rpc('kanban.deleteEpic', { epicId: epic.id })
      if (!res?.ok) throw new Error('Delete rejected')
      notifications.show({ color: 'green', title: 'Epic deleted', message: 'Tasks were unassigned.' })
    } catch (err) {
      console.error('[kanban] delete epic failed:', err)
      notifications.show({ color: 'red', title: 'Delete failed', message: String(err) })
    }
  }

  if (loading && !board) {
    return (
      <Box p="xl" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Loader color="blue" size="lg" />
        <Text c="dimmed">Loading Kanban board…</Text>
      </Box>
    )
  }

  if (!board) {
    return (
      <Box p="xl">
        <Title order={3} c="white">Kanban board unavailable</Title>
        <Text c="dimmed" mt="sm">
          Unable to load the Kanban board. Ensure the workspace is initialized correctly and try again.
        </Text>
      </Box>
    )
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 16 }}>
      <Group justify="space-between" align="center">
        <Group>
          <Title order={2} c="white">Kanban Board</Title>
        </Group>
        <Group gap="sm">
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => openCreateTask('backlog')}
            size="xs"
            variant="light"
          >
            New Task
          </Button>
          <Button
            leftSection={<IconColumns3 size={16} />}
            onClick={() => setEpicDrawerOpen(true)}
            size="xs"
            variant="subtle"
          >
            Manage Epics
          </Button>
        </Group>
      </Group>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 16,
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {COLUMNS.map(({ status, label }) => (
            <Droppable droppableId={status} key={status}>
              {(provided, snapshot) => (
                <Paper
                  withBorder
                  radius="md"
                  p="sm"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    backgroundColor: snapshot.isDraggingOver
                      ? `${theme.colors.blue[7]}26`
                      : 'rgba(255,255,255,0.03)',
                  }}
                >
                  <Group justify="space-between" align="center">
                    <Group gap="xs">
                      <Title order={5} c="white">
                        {label}
                      </Title>
                      <Badge variant="filled" color="gray" radius="sm">
                        {tasksByStatus[status].length}
                      </Badge>
                    </Group>
                    <ActionIcon variant="subtle" size="sm" onClick={() => openCreateTask(status)}>
                      <IconPlus size={16} />
                    </ActionIcon>
                  </Group>

                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{ flex: 1, marginTop: 12, overflowY: 'auto' }}
                  >
                    <Stack gap="sm">
                      {tasksByStatus[status].map((task, index) => (
                        <Draggable draggableId={task.id} index={index} key={task.id}>
                          {(dragProvided, dragSnapshot) => (
                            <KanbanTaskCard
                              task={task}
                              epic={task.epicId ? epicMap.get(task.epicId) ?? null : null}
                              provided={dragProvided}
                              dragging={dragSnapshot.isDragging}
                              onEdit={() => openEditTask(task)}
                              onDelete={() => handleDeleteTask(task)}
                            />
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {tasksByStatus[status].length === 0 && (
                        <Box c="dimmed" ta="center" py="lg" fz="sm">
                          No tasks
                        </Box>
                      )}
                    </Stack>
                  </div>
                </Paper>
              )}
            </Droppable>
          ))}
        </Box>
      </DragDropContext>

      <TaskModal
        state={taskModal}
        onClose={closeTaskModal}
        onSubmit={handleSubmitTask}
        epics={epics}
        saving={saving}
      />

      <EpicModal
        state={epicModal}
        onClose={closeEpicModal}
        onSubmit={handleSubmitEpic}
        onDelete={handleDeleteEpic}
        saving={saving}
      />

      <EpicDrawer
        open={epicDrawerOpen}
        onClose={() => setEpicDrawerOpen(false)}
        epics={epics}
        onCreate={openCreateEpic}
        onEdit={openEditEpic}
        onDelete={handleDeleteEpic}
      />
    </Box>
  )
}

type KanbanTaskCardProps = {
  task: KanbanTask
  epic: KanbanEpic | null
  provided: any
  dragging: boolean
  onEdit: () => void
  onDelete: () => void
}

function KanbanTaskCard({ task, epic, provided, dragging, onEdit, onDelete }: KanbanTaskCardProps) {
  return (
    <Paper
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      withBorder
      radius="md"
      p="sm"
      style={{
        backgroundColor: dragging ? 'rgba(57, 147, 255, 0.18)' : 'rgba(20,20,20,0.9)',
        boxShadow: dragging ? '0 8px 20px rgba(0,0,0,0.35)' : 'none',
        cursor: 'grab',
        ...(provided.draggableProps.style as any),
      }}
    >
      <Group justify="space-between" align="flex-start" gap="sm">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} c="white">
            {task.title}
          </Text>
          {epic && (
            <Badge color={epic.color || 'blue'} variant="light" mt={6} size="sm">
              {epic.name}
            </Badge>
          )}
          {task.description && (
            <Box mt="sm" style={{ maxHeight: 160, overflow: 'hidden' }}>
              <StreamingMarkdown content={task.description} showCursor={false} />
            </Box>
          )}
        </Box>
        <Stack gap={4}>
          <ActionIcon variant="subtle" size="sm" onClick={onEdit}>
            <IconEdit size={16} />
          </ActionIcon>
          <ActionIcon variant="subtle" size="sm" color="red" onClick={onDelete}>
            <IconTrash size={16} />
          </ActionIcon>
        </Stack>
      </Group>
    </Paper>
  )
}

type TaskModalProps = {
  state: TaskModalState | null
  onClose: () => void
  onSubmit: (values: TaskFormValues, existingId?: string) => Promise<void>
  epics: KanbanEpic[]
  saving: boolean
}

function TaskModal({ state, onClose, onSubmit, epics, saving }: TaskModalProps) {

  const initial: TaskFormValues = useMemo(() => {
    if (!state) {
      return { title: '', status: 'backlog', epicId: null, description: '' }
    }
    if (state.mode === 'create') {
      return { title: '', status: state.status, epicId: null, description: '' }
    }
    const { task } = state
    return {
      title: task.title,
      status: task.status,
      epicId: task.epicId ?? null,
      description: task.description ?? '',
    }
  }, [state])

  const [values, setValues] = useState<TaskFormValues>(initial)

  useEffect(() => {
    setValues(initial)
  }, [initial])

  if (!state) return null

  const handleSubmit = () => {
    if (!values.title.trim()) {
      notifications.show({ color: 'red', title: 'Validation', message: 'Title is required.' })
      return
    }
    void onSubmit(
      {
        title: values.title.trim(),
        status: values.status,
        epicId: values.epicId,
        description: values.description.trim(),
      },
      state.mode === 'edit' ? state.task.id : undefined,
    )
  }

  return (
    <Modal
      opened={!!state}
      onClose={onClose}
      title={state.mode === 'create' ? 'New Task' : 'Edit Task'}
      centered
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label="Title"
          value={values.title}
          onChange={(event) => setValues((prev) => ({ ...prev, title: event.currentTarget.value }))}
          withAsterisk
        />
        <Group grow>
          <Select
            label="Status"
            data={COLUMNS.map(({ status, label }) => ({ value: status, label }))}
            value={values.status}
            onChange={(value) =>
              setValues((prev) => ({ ...prev, status: (value as KanbanStatus) ?? prev.status }))
            }
          />
          <Select
            label="Epic"
            data={epics.map((epic) => ({ value: epic.id, label: epic.name }))}
            allowDeselect
            placeholder="Unassigned"
            value={values.epicId}
            onChange={(value) => setValues((prev) => ({ ...prev, epicId: value }))}
          />
        </Group>
        <Textarea
          label="Description"
          minRows={4}
          autosize
          value={values.description}
          onChange={(event) => setValues((prev) => ({ ...prev, description: event.currentTarget.value }))}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            {state.mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

type EpicModalProps = {
  state: EpicModalState | null
  onClose: () => void
  onSubmit: (values: EpicFormValues, existingId?: string) => Promise<void>
  onDelete: (epic: KanbanEpic) => Promise<void>
  saving: boolean
}

function EpicModal({ state, onClose, onSubmit, onDelete, saving }: EpicModalProps) {
  const initial: EpicFormValues = useMemo(() => {
    if (!state || state.mode === 'create') {
      return { name: '', color: '#5C7AEA', description: '' }
    }
    return {
      name: state.epic.name,
      color: state.epic.color,
      description: state.epic.description ?? '',
    }
  }, [state])

  const [values, setValues] = useState<EpicFormValues>(initial)

  useEffect(() => {
    setValues(initial)
  }, [initial])

  if (!state) return null

  const handleSubmit = () => {
    if (!values.name.trim()) {
      notifications.show({ color: 'red', title: 'Validation', message: 'Name is required.' })
      return
    }
    void onSubmit(
      {
        name: values.name.trim(),
        color: values.color?.trim() || undefined,
        description: values.description?.trim() || undefined,
      },
      state.mode === 'edit' ? state.epic.id : undefined,
    )
  }

  const handleDelete = () => {
    if (state.mode === 'edit') {
      void onDelete(state.epic)
      onClose()
    }
  }

  return (
    <Modal
      opened={!!state}
      onClose={onClose}
      title={state.mode === 'create' ? 'New Epic' : 'Edit Epic'}
      centered
      size="md"
    >
      <Stack gap="md">
        <TextInput
          label="Name"
          value={values.name}
          onChange={(event) => setValues((prev) => ({ ...prev, name: event.currentTarget.value }))}
          withAsterisk
        />
        <TextInput
          label="Color"
          value={values.color ?? ''}
          onChange={(event) => setValues((prev) => ({ ...prev, color: event.currentTarget.value }))}
          placeholder="#5C7AEA"
        />
        <Textarea
          label="Description"
          minRows={3}
          autosize
          value={values.description ?? ''}
          onChange={(event) => setValues((prev) => ({ ...prev, description: event.currentTarget.value }))}
        />
        <Group justify="space-between" gap="sm">
          {state.mode === 'edit' ? (
            <Button variant="outline" color="red" onClick={handleDelete} leftSection={<IconTrash size={16} />}>
              Delete
            </Button>
          ) : (
            <div />
          )}
          <Group gap="sm">
            <Button variant="default" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              {state.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

type EpicDrawerProps = {
  open: boolean
  onClose: () => void
  epics: KanbanEpic[]
  onCreate: () => void
  onEdit: (epic: KanbanEpic) => void
  onDelete: (epic: KanbanEpic) => Promise<void>
}

function EpicDrawer({ open, onClose, epics, onCreate, onEdit, onDelete }: EpicDrawerProps) {
  return (
    <Drawer opened={open} onClose={onClose} title="Epics" position="right" size="md">
      <Stack gap="md">
        <Button leftSection={<IconFolderPlus size={16} />} onClick={onCreate} variant="light">
          New Epic
        </Button>
        {epics.length === 0 && (
          <Text c="dimmed">No epics yet. Create one to group related tasks.</Text>
        )}
        {epics.map((epic) => (
          <Paper key={epic.id} withBorder radius="md" p="sm">
            <Group justify="space-between" align="flex-start">
              <Box>
                <Text fw={600}>{epic.name}</Text>
                {epic.description && (
                  <Text c="dimmed" fz="sm" mt={4}>
                    {epic.description}
                  </Text>
                )}
              </Box>
              <Group gap="xs">
                <ActionIcon variant="subtle" size="sm" onClick={() => onEdit(epic)}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" size="sm" color="red" onClick={() => void onDelete(epic)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Drawer>
  )
}
