import type { StateCreator } from 'zustand'
import { listItems, createItem, updateItem, deleteItem, search, readById, normalizeMarkdown, extractTrailingMeta, type KbItem, type KbHit } from '../utils/knowledgeBase'
import { listWorkspaceFiles } from '../utils/workspace-helpers'

export interface KnowledgeBaseSlice {
  // State
  kbLoading: boolean
  kbItems: Record<string, KbItem>
  kbBodies: Record<string, string>
  kbFiles: Record<string, string[]>
  kbWorkspaceFiles: string[]
  kbLastError?: string | null

  // Search state/results (renderer reads reactively)
  kbSearchQuery: string
  kbSearchTags: string[]
  kbSearchResults: KbHit[]

  // Operation result channel (zubridge-safe)
  kbOpResult: { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null

  // Actions
  kbReloadIndex: () => Promise<void>
  kbCreateItem: (params: { title: string; description: string; tags?: string[]; files?: string[] }) => Promise<void>
  kbUpdateItem: (params: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }) => Promise<void>
  kbDeleteItem: (params: { id: string }) => Promise<void>

  kbReadItemBody: (params: { id: string }) => Promise<void>
  kbRefreshWorkspaceFileIndex: (params?: { includeExts?: string[]; max?: number }) => Promise<void>

  setKbSearchQuery: (query: string) => void
  setKbSearchTags: (tags: string[]) => void
  kbSearch: (params?: { query?: string; tags?: string[]; limit?: number }) => Promise<void>
  kbClearOpResult: () => void
}

export const createKnowledgeBaseSlice: StateCreator<KnowledgeBaseSlice> = (set, get) => ({
  // State
  kbLoading: false,
  kbItems: {},
  kbBodies: {},
  kbFiles: {},
  kbWorkspaceFiles: [],
  kbLastError: null,

  kbSearchQuery: '',
  kbSearchTags: [],
  kbSearchResults: [],

  kbOpResult: null,

  // Actions
  kbReloadIndex: async () => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      set({ kbLoading: true, kbLastError: null })
      const items = await listItems(baseDir)
      const map: Record<string, KbItem> = {}
      for (const it of items) map[it.id] = it
      set({ kbItems: map, kbLoading: false })
    } catch (e: any) {
      set({ kbLoading: false, kbLastError: String(e) })
    }
  },

  kbCreateItem: async ({ title, description, tags, files }) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      set({ kbLastError: null })
      const item = await createItem(baseDir, { title, description: normalizeMarkdown(description), tags, files })
      set((s) => ({ kbItems: { ...s.kbItems, [item.id]: item }, kbOpResult: { ok: true, op: 'create', id: item.id } }))
    } catch (e: any) {
      set({ kbLastError: String(e), kbOpResult: { ok: false, op: 'create', error: String(e) } })
    }
  },

  kbUpdateItem: async ({ id, patch }) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      set({ kbLastError: null })
      const item = await updateItem(baseDir, { id, patch: { ...patch, description: patch.description !== undefined ? normalizeMarkdown(patch.description) : undefined } })
      if (item) {
        set((s) => ({ kbItems: { ...s.kbItems, [item.id]: item }, kbOpResult: { ok: true, op: 'update', id: item.id } }))
      } else {
        set({ kbLastError: 'Not found', kbOpResult: { ok: false, op: 'update', id, error: 'Not found' } })
      }
    } catch (e: any) {
      set({ kbLastError: String(e), kbOpResult: { ok: false, op: 'update', id, error: String(e) } })
    }
  },

  kbDeleteItem: async ({ id }) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      set({ kbLastError: null })
      const ok = await deleteItem(baseDir, id)
      if (ok) {
        set((s) => {
          const map = { ...s.kbItems }
          delete map[id]
          return { kbItems: map, kbOpResult: { ok: true, op: 'delete', id } }
        })
      } else {
        set({ kbLastError: 'Not found', kbOpResult: { ok: false, op: 'delete', id, error: 'Not found' } })
      }
    } catch (e: any) {
      set({ kbLastError: String(e), kbOpResult: { ok: false, op: 'delete', id, error: String(e) } })
    }
  },

  kbRefreshWorkspaceFileIndex: async (params) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      const files = await listWorkspaceFiles(baseDir, { includeExts: params?.includeExts, max: params?.max })
      set({ kbWorkspaceFiles: files })
    } catch (e: any) {
      set({ kbLastError: String(e) })
    }
  },

  setKbSearchQuery: (query) => set({ kbSearchQuery: query }),
  setKbSearchTags: (tags) => set({ kbSearchTags: tags }),

  kbSearch: async (params) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    const query = params?.query ?? get().kbSearchQuery
    const tags = params?.tags ?? get().kbSearchTags
    const limit = params?.limit
    try {
      set({ kbLastError: null, kbLoading: true })
      const results = await search(baseDir, { query, tags, limit })
      set({ kbSearchResults: results, kbLoading: false })
    } catch (e: any) {
      set({ kbLoading: false, kbLastError: String(e) })
    }
  },

  kbReadItemBody: async ({ id }) => {
    const baseDir = (get() as any).workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    try {
      const found = await readById(baseDir, id)
      if (found) {
        const norm = normalizeMarkdown(found.body ?? '')
        const { body } = extractTrailingMeta(norm)
        set((s) => ({
          kbBodies: { ...s.kbBodies, [id]: body },
          kbFiles: { ...s.kbFiles, [id]: (found.meta as any).files || [] }
        }))
      }
    } catch (e: any) {
      set({ kbLastError: String(e) })
    }
  },

  kbClearOpResult: () => set({ kbOpResult: null }),
})

