import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Drawer,
  Group,
  Modal,
  Paper,
  Select,
  Skeleton,
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
import { IconPlus, IconEdit, IconTrash, IconColumns3, IconFolderPlus, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'

import { getBackendClient } from '../../lib/backend/bootstrap'
import type { KanbanEpic, KanbanStatus, KanbanTask, KanbanBoard } from '../../../electron/store/types'
import { useKanban } from '@/store/kanban'
import { useKanbanHydration } from '@/store/screenHydration'
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

/**
 * Skeleton for Kanban board while loading
 */
function KanbanSkeleton() {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 16 }}>
      {/* Header skeleton */}
      <Group justify="space-between">
        <Skeleton width={180} height={32} radius="sm" />
        <Group gap="sm">
          <Skeleton width={80} height={28} radius="sm" />
          <Skeleton width={80} height={28} radius="sm" />
        </Group>
      </Group>
      {/* Columns skeleton */}
      <Box style={{ display: 'flex', gap: 16, flex: 1 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Box key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton width={100} height={24} radius="sm" />
            <Skeleton height={80} radius="md" />
            <Skeleton height={80} radius="md" />
            <Skeleton height={80} radius="md" />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default function KanbanView() {
  const theme = useMantineTheme()

  // Screen hydration state
  const screenPhase = useKanbanHydration((s) => s.phase)
  const screenError = useKanbanHydration((s) => s.error)
  const startLoading = useKanbanHydration((s) => s.startLoading)
  const setReady = useKanbanHydration((s) => s.setReady)
  const setScreenError = useKanbanHydration((s) => s.setError)

  // Get state from store (not local state!)
  const board = useKanban((s) => s.board)
  const saving = useKanban((s) => s.saving)
  const error = useKanban((s) => s.error)
  const setBoard = useKanban((s) => s.setBoard)

  const epics = board?.epics ?? []

  // Load kanban data
  const loadKanban = useCallback(async () => {
    try {
      const client = getBackendClient()
      if (!client) throw new Error('No backend connection')

      // First trigger a load from disk if not already loaded
      await client.rpc('kanban.load', {})

      // Then get the current board state
      const res: any = await client.rpc('kanban.getBoard', {})
      if (res?.ok) {
        // Board can be null if no kanban.yaml exists yet - that's fine
        setBoard(res.board)
        setReady()
      } else {
        throw new Error(res?.error || 'Failed to load board')
      }
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : 'Failed to load kanban board')
    }
  }, [setBoard, setReady, setScreenError])

  // Auto-load on mount if in idle state
  useEffect(() => {
    if (screenPhase === 'idle') {
      startLoading()
      loadKanban()
    }
  }, [screenPhase, startLoading, loadKanban])

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

  // Board is pre-fetched during loading overlay phase, no need to load on mount

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

  // Show error notification when board operations fail
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

  // Render based on screen phase
  if (screenPhase === 'idle' || screenPhase === 'loading') {
    return <KanbanSkeleton />
  }

  if (screenPhase === 'error') {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
          <Text size="sm" c="dimmed" ta="center">
            {screenError ?? 'Failed to load kanban board'}
          </Text>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              startLoading()
              loadKanban()
            }}
          >
            Retry
          </Button>
        </Stack>
      </Center>
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
