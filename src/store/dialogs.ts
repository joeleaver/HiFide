import { create } from 'zustand'

type PromptResolve = (value: string | null) => void
type ConfirmResolve = (value: boolean) => void

export type PromptDialogOptions = {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
}

type PromptDialogState = PromptDialogOptions & {
  id: string
  resolve: PromptResolve
}

export type ConfirmDialogOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  intent?: 'default' | 'danger'
}

type ConfirmDialogState = ConfirmDialogOptions & {
  id: string
  resolve: ConfirmResolve
}

type DialogStore = {
  prompt: PromptDialogState | null
  confirm: ConfirmDialogState | null
  requestPrompt: (options: PromptDialogOptions) => Promise<string | null>
  requestConfirm: (options: ConfirmDialogOptions) => Promise<boolean>
  submitPrompt: (value: string) => void
  cancelPrompt: () => void
  confirmConfirm: () => void
  cancelConfirm: () => void
}

const generateId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `dlg-${Date.now()}-${Math.random().toString(16).slice(2)}`)

export const useDialogStore = create<DialogStore>((set, get) => ({
  prompt: null,
  confirm: null,
  requestPrompt: (options) =>
    new Promise<string | null>((resolve) => {
      set({ prompt: { ...options, id: generateId(), resolve } })
    }),
  requestConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({ confirm: { ...options, id: generateId(), resolve } })
    }),
  submitPrompt: (value) => {
    const prompt = get().prompt
    if (!prompt) return
    prompt.resolve(value)
    set({ prompt: null })
  },
  cancelPrompt: () => {
    const prompt = get().prompt
    if (prompt) {
      prompt.resolve(null)
    }
    set({ prompt: null })
  },
  confirmConfirm: () => {
    const confirm = get().confirm
    if (!confirm) return
    confirm.resolve(true)
    set({ confirm: null })
  },
  cancelConfirm: () => {
    const confirm = get().confirm
    if (confirm) {
      confirm.resolve(false)
    }
    set({ confirm: null })
  },
}))

export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return useDialogStore.getState().requestPrompt(options)
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return useDialogStore.getState().requestConfirm(options)
}

export function submitPromptInput(value: string) {
  useDialogStore.getState().submitPrompt(value)
}

export function cancelPromptDialog() {
  useDialogStore.getState().cancelPrompt()
}

export function acceptConfirmDialog() {
  useDialogStore.getState().confirmConfirm()
}

export function cancelConfirmDialog() {
  useDialogStore.getState().cancelConfirm()
}
