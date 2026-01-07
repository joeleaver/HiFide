/**
 * Knowledge Base Service
 * 
 * Manages knowledge base items (CRUD operations) and semantic search.
 */

import { Service } from './base/Service.js'
import type { KbItem, KbHit } from '../store/utils/knowledgeBase.js'
import { listItems } from '../store/utils/knowledgeBase.js'


import path from 'node:path'
// import { broadcastWorkspaceNotification } from '../backend/ws/broadcast.js'

interface KnowledgeBaseWorkspaceState {
  kbLoading: boolean
  kbItems: Record<string, KbItem>
  kbWorkspaceFiles: string[]
  kbLastError: string | null
  kbSearchQuery: string
  kbSearchTags: string[]
  kbSearchResults: KbHit[]
  kbOpResult: { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null
}

interface KnowledgeBaseState {
  workspaces: Record<string, KnowledgeBaseWorkspaceState>
}

export class KnowledgeBaseService extends Service<KnowledgeBaseState> {
  constructor() {
    super({ workspaces: {} })
  }

  protected onStateChange(): void {
    // Workspace-scoped notifications are emitted explicitly
  }

  private createWorkspaceState(): KnowledgeBaseWorkspaceState {
    return {
      kbLoading: false,
      kbItems: {},
      kbWorkspaceFiles: [],
      kbLastError: null,
      kbSearchQuery: '',
      kbSearchTags: [],
      kbSearchResults: [],
      kbOpResult: null,
    }
  }

  private normalizeWorkspaceId(workspaceId: string): string {
    if (!workspaceId) {
      throw new Error('Workspace ID is required. KB is workspace-scoped.')
    }
    try {
      return path.resolve(workspaceId)
    } catch {
      return workspaceId
    }
  }

  private getWorkspaceState(workspaceId: string): KnowledgeBaseWorkspaceState {
    const normalized = this.normalizeWorkspaceId(workspaceId)
    return this.state.workspaces[normalized] ?? this.createWorkspaceState()
  }

  private updateWorkspaceState(
    workspaceId: string,
    updates: Partial<KnowledgeBaseWorkspaceState>
  ): KnowledgeBaseWorkspaceState {
    const normalized = this.normalizeWorkspaceId(workspaceId)
    const prev = this.getWorkspaceState(normalized)
    const next = { ...prev, ...updates }
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: next,
      },
    })

    // Emit events when KB items change
    if (updates.kbItems !== undefined || updates.kbLastError !== undefined) {
      this.events.emit('kb:items:changed', {
        workspaceId: normalized,
        items: next.kbItems,
        error: next.kbLastError,
      })
    }

    // Emit events when KB workspace files change
    if (updates.kbWorkspaceFiles !== undefined) {
      this.events.emit('kb:workspaceFiles:changed', {
        workspaceId: normalized,
        files: next.kbWorkspaceFiles,
      })
    }

    return next
  }

  // Getters
  isLoading(workspaceId: string): boolean {
    return this.getWorkspaceState(workspaceId).kbLoading
  }

  getItems(workspaceId: string): Record<string, KbItem> {
    return this.getWorkspaceState(workspaceId).kbItems
  }

  getWorkspaceFiles(workspaceId: string): string[] {
    return this.getWorkspaceState(workspaceId).kbWorkspaceFiles
  }

  getLastError(workspaceId: string): string | null {
    return this.getWorkspaceState(workspaceId).kbLastError
  }

  getSearchQuery(workspaceId: string): string {
    return this.getWorkspaceState(workspaceId).kbSearchQuery
  }

  getSearchTags(workspaceId: string): string[] {
    return this.getWorkspaceState(workspaceId).kbSearchTags
  }

  getSearchResults(workspaceId: string): KbHit[] {
    return this.getWorkspaceState(workspaceId).kbSearchResults
  }

  getOpResult(workspaceId: string): { ok: boolean; op: 'create' | 'update' | 'delete'; id?: string; error?: string } | null {
    return this.getWorkspaceState(workspaceId).kbOpResult
  }

  // Setters
  setKbSearchQuery(workspaceId: string, query: string): void {
    this.updateWorkspaceState(workspaceId, { kbSearchQuery: query })
  }

  setKbSearchTags(workspaceId: string, tags: string[]): void {
    this.updateWorkspaceState(workspaceId, { kbSearchTags: tags })
  }

  setKbItems(workspaceId: string, items: Record<string, KbItem>): void {
    this.updateWorkspaceState(workspaceId, { kbItems: items })
  }

  setKbWorkspaceFiles(workspaceId: string, files: string[]): void {
    this.updateWorkspaceState(workspaceId, { kbWorkspaceFiles: files })
  }

  async syncFromDisk(workspaceId: string): Promise<void> {
    const workspaceRoot = this.normalizeWorkspaceId(workspaceId)
    try {
      const items = await listItems(workspaceRoot)
      const kbItems: Record<string, KbItem> = {}
      for (const item of items) {
        kbItems[item.id] = item
      }
      this.setKbItems(workspaceRoot, kbItems)
    } catch (error) {
      console.error('[KnowledgeBaseService] Failed to sync from disk:', error)
      this.updateWorkspaceState(workspaceRoot, { kbLastError: 'Failed to sync from disk' })
    }
  }

  kbClearOpResult(workspaceId: string): void {
    this.updateWorkspaceState(workspaceId, { kbOpResult: null })
  }
}
