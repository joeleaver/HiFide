import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

interface KnowledgeBaseStore {
  itemsMap: Record<string, any>
  workspaceFiles: string[]
  loading: boolean
  
  setItemsMap: (items: Record<string, any>) => void
  setWorkspaceFiles: (files: string[]) => void
  setLoading: (loading: boolean) => void
  reloadIndex: () => Promise<void>
}

export const useKnowledgeBase = create<KnowledgeBaseStore>((set) => ({
  itemsMap: {},
  workspaceFiles: [],
  loading: false,
  
  setItemsMap: (items) => set({ itemsMap: items }),
  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  setLoading: (loading) => set({ loading }),
  
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

