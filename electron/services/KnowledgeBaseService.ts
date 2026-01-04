/**
 * Knowledge Base Service
 * 
 * Manages knowledge base items (CRUD operations) and semantic search.
 */

import { Service } from './base/Service.js'
import type { KbItem, KbHit } from '../store/utils/knowledgeBase.js'
import { listItems } from '../store/utils/knowledgeBase.js'


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

  setKbItems(items: Record<string, KbItem>): void {
    this.setState({ kbItems: items })
  }

  async syncFromDisk(workspaceRoot: string): Promise<void> {
    try {
      const items = await listItems(workspaceRoot)
      const kbItems: Record<string, KbItem> = {}
      for (const item of items) {
        kbItems[item.id] = item
      }
      this.setKbItems(kbItems)
    } catch (error) {
      console.error('[KnowledgeBaseService] Failed to sync from disk:', error)
      this.setState({ kbLastError: 'Failed to sync from disk' })
    }
  }

  kbClearOpResult(): void {
    this.setState({ kbOpResult: null })
  }
}
