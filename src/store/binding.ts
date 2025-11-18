import { create } from 'zustand'

export interface BackendBindingState {
  // Stable identity for this window (assigned at launch)
  windowId: number | null
  // Canonical workspace identity (temporary: use root as ID until main emits a UUID)
  workspaceId: string | null
  // Informational: normalized workspace root path
  root: string | null
  // True once this window is attached to a workspace in the backend
  attached: boolean

  // Internal setters
  setBinding: (p: Partial<Pick<BackendBindingState, 'windowId' | 'workspaceId' | 'root' | 'attached'>>) => void
  clearBinding: () => void
}

function createBindingStore() {
  return create<BackendBindingState>((set) => ({
    windowId: null,
    workspaceId: null,
    root: null,
    attached: false,
    setBinding: (p) => set((s) => ({ ...s, ...p })),
    clearBinding: () => set({ windowId: null, workspaceId: null, root: null, attached: false })
  }))
}

// HMR reuse pattern to keep a single store per window during hot reloads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __bindingStore: any = hotData.bindingStore || createBindingStore()
export const useBackendBinding = __bindingStore
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => { data.bindingStore = __bindingStore })
}

