import { create } from 'zustand'
import { KanbanStatus, KanbanTask, KanbanEpic } from './kanban'

// Modal and form states
export type TaskModalState =
  | { mode: 'create'; status: KanbanStatus }
  | { mode: 'edit'; task: KanbanTask }
  | null

export type EpicModalState =
  | { mode: 'create' }
  | { mode: 'edit'; epic: KanbanEpic }
  | null

export type TaskFormValues = {
  title: string
  status: KanbanStatus
  epicId: string | null
  kbArticleId: string | null
  description: string
}

export type EpicFormValues = {
  name: string
  color?: string
  description?: string
}

export type ArchiveMode = 'today' | 'week' | 'custom'

interface KanbanUIStore {
  // Modal states
  taskModal: TaskModalState
  epicModal: EpicModalState
  epicDrawerOpen: boolean
  archiveModalOpen: boolean

  // Form states
  taskForm: TaskFormValues
  epicForm: EpicFormValues
  archiveMode: ArchiveMode
  archiveCustomDate: string
  archiving: boolean

  // Actions
  openCreateTask: (status: KanbanStatus) => void
  openEditTask: (task: KanbanTask) => void
  closeTaskModal: () => void
  
  openCreateEpic: () => void
  openEditEpic: (epic: KanbanEpic) => void
  closeEpicModal: () => void
  
  setEpicDrawerOpen: (open: boolean) => void
  setArchiveModalOpen: (open: boolean) => void
  
  // Form update actions
  updateTaskForm: (updates: Partial<TaskFormValues>) => void
  updateEpicForm: (updates: Partial<EpicFormValues>) => void
  resetTaskForm: () => void
  resetEpicForm: () => void
  
  // Archive form actions
  setArchiveMode: (mode: ArchiveMode) => void
  setArchiveCustomDate: (date: string) => void
  resetArchiveForm: () => void
  setArchiving: (value: boolean) => void
  
  // Derived helpers
  isTaskFormValid: () => boolean
  isEpicFormValid: () => boolean
  isArchiveFormValid: () => boolean
}

const DEFAULT_TASK_FORM: TaskFormValues = {
  title: '',
  status: 'backlog',
  epicId: null,
  kbArticleId: null,
  description: ''
}

const DEFAULT_EPIC_FORM: EpicFormValues = {
  name: '',
  color: '#5C7AEA',
  description: ''
}

export const useKanbanUI = create<KanbanUIStore>((set, get) => ({
  taskModal: null,
  epicModal: null,
  epicDrawerOpen: false,
  archiveModalOpen: false,
  
  taskForm: { ...DEFAULT_TASK_FORM },
  epicForm: { ...DEFAULT_EPIC_FORM },
  archiveMode: 'week',
  archiveCustomDate: '',
  archiving: false,

  openCreateTask: (status) => {
    set({
      taskModal: { mode: 'create', status },
      taskForm: { ...DEFAULT_TASK_FORM, status }
    })
  },

  openEditTask: (task) => {
    set({
      taskModal: { mode: 'edit', task },
      taskForm: {
        title: task.title,
        status: task.status,
        epicId: task.epicId ?? null,
        kbArticleId: task.kbArticleId ?? null,
        description: task.description ?? ''
      }
    })
  },

  closeTaskModal: () => {
    set({
      taskModal: null,
      taskForm: { ...DEFAULT_TASK_FORM }
    })
  },

  openCreateEpic: () => {
    set({
      epicModal: { mode: 'create' },
      epicForm: { ...DEFAULT_EPIC_FORM }
    })
  },

  openEditEpic: (epic) => {
    set({
      epicModal: { mode: 'edit', epic },
      epicForm: {
        name: epic.name,
        color: epic.color,
        description: epic.description ?? ''
      }
    })
  },

  closeEpicModal: () => {
    set({
      epicModal: null,
      epicForm: { ...DEFAULT_EPIC_FORM }
    })
  },

  setEpicDrawerOpen: (open) => set({ epicDrawerOpen: open }),
  setArchiveModalOpen: (open) => {
    if (open) {
      set({ archiveModalOpen: true })
      return
    }
    set({ archiveModalOpen: false, archiveMode: 'week', archiveCustomDate: '', archiving: false })
  },

  updateTaskForm: (updates) => {
    set((state) => ({
      taskForm: { ...state.taskForm, ...updates }
    }))
  },

  updateEpicForm: (updates) => {
    set((state) => ({
      epicForm: { ...state.epicForm, ...updates }
    }))
  },

  resetTaskForm: () => set({ taskForm: { ...DEFAULT_TASK_FORM } }),
  resetEpicForm: () => set({ epicForm: { ...DEFAULT_EPIC_FORM } }),

  setArchiveMode: (mode) => set({ archiveMode: mode }),
  setArchiveCustomDate: (date) => set({ archiveCustomDate: date }),
  resetArchiveForm: () => set({ archiveMode: 'week', archiveCustomDate: '', archiving: false }),
  setArchiving: (value) => set({ archiving: value }),

  isTaskFormValid: () => {
    const { taskForm } = get()
    return taskForm.title.trim().length > 0
  },

  isEpicFormValid: () => {
    const { epicForm } = get()
    return epicForm.name.trim().length > 0
  },

  isArchiveFormValid: () => {
    const { archiveMode, archiveCustomDate } = get()
    if (archiveMode === 'custom') {
      return archiveCustomDate.trim().length > 0
    }
    return true
  }
}))