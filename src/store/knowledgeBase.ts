import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { useWorkspaceUi } from './workspaceUi'

export interface KnowledgeBaseStore {
  itemsMap: Record<string, any>
  workspaceFiles: string[]
  loading: boolean
  workspaceFilesLoading: boolean
  activeItemId: string | null

  setItemsMap: (items: Record<string, any>) => void
  setWorkspaceFiles: (files: string[]) => void
  setLoading: (loading: boolean) => void
  setActiveItemId: (id: string | null) => void
  refreshWorkspaceFiles: () => Promise<void>
  reloadIndex: () => Promise<void>
}

export const useKnowledgeBase = create<KnowledgeBaseStore>((set, get) => ({
  itemsMap: {},
  workspaceFiles: [],
  loading: false,
  workspaceFilesLoading: false,
  activeItemId: null,

  setItemsMap: (items) => set({ itemsMap: items }),
  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  setLoading: (loading) => set({ loading }),
  setActiveItemId: (id) => set({ activeItemId: id }),

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
    const currentWorkspaceId = useWorkspaceUi.getState().root
    if (p?.workspaceId && currentWorkspaceId && p.workspaceId !== currentWorkspaceId) {
      return
    }
    useKnowledgeBase.getState().setItemsMap(p?.items || {})
  })
  
  // Files changed
  client.subscribe('kb.files.changed', (p: any) => {
    const currentWorkspaceId = useWorkspaceUi.getState().root
    if (p?.workspaceId && currentWorkspaceId && p.workspaceId !== currentWorkspaceId) {
      return
    }
    useKnowledgeBase.getState().setWorkspaceFiles(Array.isArray(p?.files) ? p.files : [])
  })
}

