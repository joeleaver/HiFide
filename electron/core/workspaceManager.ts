/**
 * WorkspaceManager
 *
 * Main-process singleton to manage multiple concurrently-open workspaces.
 * Tracks per-workspace services (indexers, watchers) and window bindings.
 *
 * This enables true multi-window support where each window can have its own workspace
 * with independent indexers and watchers.
 */

import { BrowserWindow } from 'electron'
import type { Indexer } from '../indexing/indexer'

export type WorkspaceId = string // absolute folder path

interface WorkspaceEntry {
  id: WorkspaceId
  windows: Set<number> // BrowserWindow.id
  refCount: number
  // Per-workspace services
  indexer?: Indexer
  kbIndexer?: Indexer
  // Note: Kanban and KB watchers are managed internally by state.ts, not stored here
}

class WorkspaceManagerImpl {
  private workspaces = new Map<WorkspaceId, WorkspaceEntry>()
  private windowToWorkspace = new Map<number, WorkspaceId>()

  async bindWindowToWorkspace(win: BrowserWindow, workspaceId: WorkspaceId): Promise<void> {
    const id = win.id
    const entry = await this.ensureEntry(workspaceId)
    entry.windows.add(id)
    entry.refCount += 1
    this.windowToWorkspace.set(id, workspaceId)
  }

  async unbindWindow(win: BrowserWindow): Promise<void> {
    const id = win.id
    const ws = this.windowToWorkspace.get(id)
    if (!ws) return
    const entry = this.workspaces.get(ws)
    if (!entry) return
    entry.windows.delete(id)
    entry.refCount = Math.max(0, entry.refCount - 1)
    this.windowToWorkspace.delete(id)
    if (entry.refCount === 0) await this.teardownWorkspace(ws)
  }

  getWorkspaceForWindow(win: BrowserWindow): WorkspaceId | undefined {
    return this.windowToWorkspace.get(win.id)
  }

  list(): WorkspaceEntry[] { return [...this.workspaces.values()] }

  /**
   * Get indexer for a workspace (creates if needed)
   */
  async getIndexer(workspaceId: WorkspaceId): Promise<Indexer> {
    const entry = await this.ensureEntry(workspaceId)
    if (!entry.indexer) {
      const { Indexer } = await import('../indexing/indexer.js')
      entry.indexer = new Indexer(workspaceId)
    }
    return entry.indexer
  }

  /**
   * Get KB indexer for a workspace (creates if needed)
   */
  async getKbIndexer(workspaceId: WorkspaceId): Promise<Indexer> {
    const entry = await this.ensureEntry(workspaceId)
    if (!entry.kbIndexer) {
      const path = await import('node:path')
      const { Indexer } = await import('../indexing/indexer.js')
      const kbRoot = path.join(workspaceId, '.hifide-public', 'kb')
      entry.kbIndexer = new Indexer(workspaceId, {
        scanRoot: kbRoot,
        indexSubdir: 'kb-index',
        useWorkspaceGitignore: false,
        mode: 'kb',
      })
    }
    return entry.kbIndexer
  }

  private async ensureEntry(id: WorkspaceId): Promise<WorkspaceEntry> {
    let entry = this.workspaces.get(id)
    if (!entry) {
      entry = { id, windows: new Set(), refCount: 0 }
      this.workspaces.set(id, entry)
      // Start watchers for this workspace
      await this.startWatchers(id, entry)
    }
    return entry
  }

  private async startWatchers(workspaceId: WorkspaceId, _entry: WorkspaceEntry): Promise<void> {
    try {
      const { startKanbanWatcher } = await import('./state.js')
      await startKanbanWatcher(workspaceId)
      // Note: _entry.kanbanWatcher is not set because state.ts manages watchers internally
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to start Kanban watcher for ${workspaceId}:`, error)
    }

    try {
      const { startKbWatcher } = await import('./state.js')
      await startKbWatcher(workspaceId)
      // Note: entry.kbWatcher is not set because state.ts manages watchers internally
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to start KB watcher for ${workspaceId}:`, error)
    }
  }

  private async teardownWorkspace(id: WorkspaceId): Promise<void> {
    const entry = this.workspaces.get(id)
    if (!entry) return

    // Stop watchers
    try {
      const { stopKanbanWatcher } = await import('./state.js')
      stopKanbanWatcher(id)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop Kanban watcher for ${id}:`, error)
    }

    try {
      const { stopKbWatcher } = await import('./state.js')
      stopKbWatcher(id)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop KB watcher for ${id}:`, error)
    }

    // Stop indexer watch if active
    try {
      if (entry.indexer) {
        entry.indexer.stopWatch()
      }
      if (entry.kbIndexer) {
        entry.kbIndexer.stopWatch()
      }
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop indexers for ${id}:`, error)
    }

    this.workspaces.delete(id)
    console.log(`[WorkspaceManager] Tore down workspace: ${id}`)
  }
}

let __instance: WorkspaceManagerImpl | null = null
export function getWorkspaceManager(): WorkspaceManagerImpl {
  if (!__instance) __instance = new WorkspaceManagerImpl()
  return __instance
}

