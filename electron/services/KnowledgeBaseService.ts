/**
 * Knowledge Base Service
 * 
 * Manages knowledge base items (CRUD operations) and semantic search.
 */

import { Service } from './base/Service.js'
import {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  normalizeMarkdown,
  search as kbSearch,
  type KbItem,
  type KbHit,
} from '../store/utils/knowledgeBase.js'
import { listWorkspaceFiles } from '../store/utils/workspace-helpers.js'
import { getKbIndexer } from '../core/state.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

interface KnowledgeBaseState {
  kbLoading: boolean
  kbItems: Record<string, KbItem>
  kbWorkspaceFiles: string[]
  kbLastError: string | null
  kbSearchQuery: string
  kbSearchTags: string[]
  kbSearchResults: KbHit[]
  kbOpResult: { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null
}

export class KnowledgeBaseService extends Service<KnowledgeBaseState> {
  constructor() {
    super({
      kbLoading: false,
      kbItems: {},
      kbWorkspaceFiles: [],
      kbLastError: null,
      kbSearchQuery: '',
      kbSearchTags: [],
      kbSearchResults: [],
      kbOpResult: null,
    })
  }

  protected onStateChange(updates: Partial<KnowledgeBaseState>): void {
    // KB state is transient, no persistence needed

    // Emit events when KB items change
    if (updates.kbItems !== undefined || updates.kbLastError !== undefined) {
      this.events.emit('kb:items:changed', {
        items: this.state.kbItems,
        error: this.state.kbLastError,
      })
    }

    // Emit events when KB workspace files change
    if (updates.kbWorkspaceFiles !== undefined) {
      this.events.emit('kb:workspaceFiles:changed', {
        files: this.state.kbWorkspaceFiles,
      })
    }
  }

  // Getters
  isLoading(): boolean {
    return this.state.kbLoading
  }

  getItems(): Record<string, KbItem> {
    return this.state.kbItems
  }

  getWorkspaceFiles(): string[] {
    return this.state.kbWorkspaceFiles
  }

  getLastError(): string | null {
    return this.state.kbLastError
  }

  getSearchQuery(): string {
    return this.state.kbSearchQuery
  }

  getSearchTags(): string[] {
    return this.state.kbSearchTags
  }

  getSearchResults(): KbHit[] {
    return this.state.kbSearchResults
  }

  getOpResult(): { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null {
    return this.state.kbOpResult
  }

  // Setters
  setKbSearchQuery(query: string): void {
    this.setState({ kbSearchQuery: query })
  }

  setKbSearchTags(tags: string[]): void {
    this.setState({ kbSearchTags: tags })
  }

  kbClearOpResult(): void {
    this.setState({ kbOpResult: null })
  }

  // Helper
  private resolveWorkspaceRoot(): string {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    return workspaceService?.getWorkspaceRoot() || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  }

  // Async operations
  async kbReloadIndex(): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    try {
      this.setState({ kbLoading: true, kbLastError: null })
      const items = await listItems(baseDir)
      const map: Record<string, KbItem> = {}
      for (const it of items) map[it.id] = it
      this.setState({ kbItems: map, kbLoading: false })
    } catch (e: any) {
      this.setState({ kbLoading: false, kbLastError: String(e) })
    }
  }

  async kbCreateItem(params: {
    title: string
    description: string
    tags?: string[]
    files?: string[]
  }): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    try {
      this.setState({ kbLastError: null })
      const item = await createItem(baseDir, {
        title: params.title,
        description: normalizeMarkdown(params.description),
        tags: params.tags,
        files: params.files,
      })
      this.setState({
        kbItems: { ...this.state.kbItems, [item.id]: item },
        kbOpResult: { ok: true, op: 'create', id: item.id },
      })
    } catch (e: any) {
      this.setState({ kbLastError: String(e), kbOpResult: { ok: false, op: 'create', error: String(e) } })
    }
  }

  async kbUpdateItem(params: {
    id: string
    patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }>
  }): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    try {
      this.setState({ kbLastError: null })
      const item = await updateItem(baseDir, {
        id: params.id,
        patch: {
          ...params.patch,
          description:
            params.patch.description !== undefined ? normalizeMarkdown(params.patch.description) : undefined,
        },
      })
      if (item) {
        this.setState({
          kbItems: { ...this.state.kbItems, [item.id]: item },
          kbOpResult: { ok: true, op: 'update', id: item.id },
        })
      } else {
        this.setState({
          kbLastError: 'Not found',
          kbOpResult: { ok: false, op: 'update', id: params.id, error: 'Not found' },
        })
      }
    } catch (e: any) {
      this.setState({
        kbLastError: String(e),
        kbOpResult: { ok: false, op: 'update', id: params.id, error: String(e) },
      })
    }
  }

  async kbDeleteItem(params: { id: string }): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    try {
      this.setState({ kbLastError: null })
      const ok = await deleteItem(baseDir, params.id)
      if (ok) {
        const map = { ...this.state.kbItems }
        delete map[params.id]
        this.setState({ kbItems: map, kbOpResult: { ok: true, op: 'delete', id: params.id } })
      } else {
        this.setState({
          kbLastError: 'Not found',
          kbOpResult: { ok: false, op: 'delete', id: params.id, error: 'Not found' },
        })
      }
    } catch (e: any) {
      this.setState({
        kbLastError: String(e),
        kbOpResult: { ok: false, op: 'delete', id: params.id, error: String(e) },
      })
    }
  }

  async kbRefreshWorkspaceFileIndex(params?: { includeExts?: string[]; max?: number }): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    try {
      const files = await listWorkspaceFiles(baseDir, { includeExts: params?.includeExts, max: params?.max })
      this.setState({ kbWorkspaceFiles: files })
    } catch (e: any) {
      this.setState({ kbLastError: String(e) })
    }
  }

  async kbSearch(params?: { query?: string; tags?: string[]; limit?: number }): Promise<void> {
    const baseDir = this.resolveWorkspaceRoot()
    const query = params?.query ?? this.state.kbSearchQuery
    const tags = params?.tags ?? this.state.kbSearchTags
    const limit = typeof params?.limit === 'number' ? params.limit : 50
    const qLower = String(query || '').toLowerCase().trim()

    try {
      this.setState({ kbLastError: null, kbLoading: true })
      const idx = await getKbIndexer()

      // Ensure KB index exists and is fresh enough for immediate search
      const st1 = idx.status()
      if (!st1.ready || (st1.chunks ?? 0) === 0) {
        try {
          await idx.rebuild(() => {})
        } catch {}
      }

      const items = await listItems(baseDir)
      const byRel: Record<string, KbHit> = {}
      for (const it of items) byRel[it.relPath.replace(/^\\?/, '')] = it as KbHit

      const k = Math.max(100, limit * 3)
      let sem = await idx.search(qLower || '', k)
      if ((sem.chunks?.length || 0) === 0) {
        try {
          await idx.rebuild(() => {})
        } catch {}
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
        const ii = s.indexOf('\n\n')
        return ii >= 0 ? s.slice(ii + 2) : s
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
        const tagBoost =
          Array.from(tagSet).filter((t) => meta.tags.map((x) => x.toLowerCase()).includes(t)).length * 0.05
        const score = baseScore + (titleMatch ? 0.3 : 0) + (literalMatch ? 0.15 : 0) + tagBoost
        const excerpt = body.slice(0, 320)
        candidates.push({ ...meta, excerpt, score })
      })

      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      let finalResults = candidates

      if (finalResults.length === 0) {
        try {
          finalResults = await kbSearch(baseDir, { query: qLower, tags, limit })
        } catch {}
      }

      this.setState({ kbSearchResults: finalResults.slice(0, limit), kbLoading: false })
    } catch (e: any) {
      this.setState({ kbLoading: false, kbLastError: String(e) })
    }
  }
}
