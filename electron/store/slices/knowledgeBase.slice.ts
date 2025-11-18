import type { StateCreator } from 'zustand'
import { listItems, createItem, updateItem, deleteItem, normalizeMarkdown, type KbItem, type KbHit } from '../utils/knowledgeBase'
import { listWorkspaceFiles } from '../utils/workspace-helpers'
import { getKbIndexer } from '../../core/state'

export interface KnowledgeBaseSlice {
  // State
  kbLoading: boolean
  kbItems: Record<string, KbItem>
  kbWorkspaceFiles: string[]
  kbLastError?: string | null

  // Search state/results (renderer reads reactively)
  kbSearchQuery: string
  kbSearchTags: string[]
  kbSearchResults: KbHit[]

  // Operation result channel (safe to send over JSON-RPC notifications)
  kbOpResult: { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null

  // Actions
  kbReloadIndex: () => Promise<void>
  kbCreateItem: (params: { title: string; description: string; tags?: string[]; files?: string[] }) => Promise<void>
  kbUpdateItem: (params: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }) => Promise<void>
  kbDeleteItem: (params: { id: string }) => Promise<void>

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
    const limit = typeof params?.limit === 'number' ? params!.limit! : 50
    const qLower = String(query || '').toLowerCase().trim()
    try {
      set({ kbLastError: null, kbLoading: true })
      const idx = await getKbIndexer()
      // Ensure KB index exists and is fresh enough for immediate search
      const st1 = idx.status()
      if (!st1.ready || (st1.chunks ?? 0) === 0) {
        try { await idx.rebuild(() => {}) } catch {}
      }
      const items = await listItems(baseDir)
      const byRel: Record<string, KbHit> = {}
      for (const it of items) byRel[it.relPath.replace(/^\\?/, '')] = it as KbHit
      const k = Math.max(100, limit * 3)
      let sem = await idx.search(qLower || '', k)
      if ((sem.chunks?.length || 0) === 0) {
        try { await idx.rebuild(() => {}) } catch {}
        sem = await idx.search(qLower || '', k)
      }
      const tagSet = new Set((tags || []).map((t: string) => t.toLowerCase()))
      const hasAll = (entryTags: string[]) => {
        if (!tagSet.size) return true
        const lc = new Set((entryTags || []).map((t) => t.toLowerCase()))
        for (const t of tagSet) if (!lc.has(t)) return false
        return true
      }
      const stripPreamble = (s: string) => {
        const ii = s.indexOf('\n\n'); return ii >= 0 ? s.slice(ii + 2) : s
      }

      const seen = new Set<string>()
      const candidates: KbHit[] = []
      sem.chunks.forEach((c, i) => {
        const p = String(c.path).replace(/^\\?/, '')
        if (seen.has(p)) return
        seen.add(p)
        const meta = byRel[p]
        if (!meta) return
        if (!hasAll(meta.tags)) return
        const baseScore = 1 - i / Math.max(1, sem.chunks.length)
        const body = stripPreamble(String(c.text || ''))
        const titleMatch = qLower && meta.title.toLowerCase().includes(qLower)
        const literalMatch = qLower && body.toLowerCase().includes(qLower)
        const tagBoost = Array.from(tagSet).filter((t) => meta.tags.map((x) => x.toLowerCase()).includes(t)).length * 0.05
        const score = baseScore + (titleMatch ? 0.3 : 0) + (literalMatch ? 0.15 : 0) + tagBoost
        const excerpt = body.slice(0, 320)
        candidates.push({ ...meta, excerpt, score })
      })
      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      let finalResults = candidates
      if (finalResults.length === 0) {
        try {
          const raw = await import('../utils/knowledgeBase')
          finalResults = await raw.search(baseDir, { query: qLower, tags, limit })
        } catch {}
      }
      set({ kbSearchResults: finalResults.slice(0, limit), kbLoading: false })
    } catch (e: any) {
      set({ kbLoading: false, kbLastError: String(e) })
    }
  },


  kbClearOpResult: () => set({ kbOpResult: null }),
})

