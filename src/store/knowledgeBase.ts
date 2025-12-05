import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

export interface KnowledgeBaseStore {
  itemsMap: Record<string, any>
  workspaceFiles: string[]
  loading: boolean
  workspaceFilesLoading: boolean

  setItemsMap: (items: Record<string, any>) => void
  setWorkspaceFiles: (files: string[]) => void
  setLoading: (loading: boolean) => void
  refreshWorkspaceFiles: () => Promise<void>
  reloadIndex: () => Promise<void>
}

export const useKnowledgeBase = create<KnowledgeBaseStore>((set, get) => ({
  itemsMap: {},
  workspaceFiles: [],
  loading: false,
  workspaceFilesLoading: false,

  setItemsMap: (items) => set({ itemsMap: items }),
  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  setLoading: (loading) => set({ loading }),

  refreshWorkspaceFiles: async () => {
    const client = getBackendClient()
    if (!client) return

    if (get().workspaceFilesLoading) return

    set({ workspaceFilesLoading: true })
    try {
      const res: any = await client.rpc('kb.refreshWorkspaceFileIndex', {})
      if (res?.ok) {
        set({ workspaceFiles: Array.isArray(res.files) ? res.files : [] })
      }
    } catch {
      // ignore errors; UI can retry via manual refresh
    } finally {
      set({ workspaceFilesLoading: false })
    }
  },

  reloadIndex: async () => {
    const client = getBackendClient()
    if (!client) return

    set({ loading: true })
    try {
      const res: any = await client.rpc('kb.reloadIndex', {})
      if (res?.ok) {
        set({ itemsMap: res.items || {} })
      }
    } catch {
    } finally {
      set({ loading: false })
    }
  }
}))

export function initKnowledgeBaseEvents(): void {
  const client = getBackendClient()
  if (!client) return
  
  // Items changed
  client.subscribe('kb.items.changed', (p: any) => {
    useKnowledgeBase.getState().setItemsMap(p?.items || {})
  })
  
  // Files changed
  client.subscribe('kb.files.changed', (p: any) => {
    useKnowledgeBase.getState().setWorkspaceFiles(Array.isArray(p?.files) ? p.files : [])
  })
}

