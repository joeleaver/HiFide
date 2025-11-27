/**
 * Workspace Service
 * 
 * Manages workspace root, multi-window support, and recent folders.
 */

import { EventEmitter } from 'node:events'
import { Service } from './base/Service.js'
import type { RecentFolder } from '../store/types.js'
import { MAX_RECENT_FOLDERS } from '../store/utils/constants.js'

interface WorkspaceState {
  workspaceRoot: string | null
  windowWorkspaces: Record<number, string>
  recentFolders: RecentFolder[]
  fileWatchCleanup: (() => void) | null
  fileWatchEvent: { path: string; event: string } | null
  ctxRefreshing: boolean
  ctxResult: { ok: boolean; error?: string } | null
}

export class WorkspaceService extends Service<WorkspaceState> {
  constructor() {
    super(
      {
        workspaceRoot: null,
        windowWorkspaces: {},
        recentFolders: [],
        fileWatchCleanup: null,
        fileWatchEvent: null,
        ctxRefreshing: false,
        ctxResult: null,
      },
      'workspace'
    )
  }

  protected onStateChange(updates: Partial<WorkspaceState>): void {
    // Persist workspace state
    if (updates.workspaceRoot !== undefined || updates.recentFolders !== undefined || updates.windowWorkspaces !== undefined) {
      this.persistence.save('workspaceRoot', this.state.workspaceRoot)
      this.persistence.save('windowWorkspaces', this.state.windowWorkspaces)
      this.persistence.save('recentFolders', this.state.recentFolders)
    }

    // Emit events for workspace changes
    if (updates.workspaceRoot !== undefined) {
      this.events.emit('workspace:changed', this.state.workspaceRoot)
    }

    if (updates.recentFolders !== undefined) {
      this.events.emit('recentFolders:changed', this.state.recentFolders)
      
      // Rebuild menu when recent folders change
      import('../menu/index.js').then(({ buildMenu }) => {
        buildMenu().catch(console.error)
      })
    }
  }

  // Getters
  getWorkspaceRoot(): string | null {
    return this.state.workspaceRoot
  }

  getRecentFolders(): RecentFolder[] {
    return [...this.state.recentFolders]
  }

  getWorkspaceForWindow(windowId: number): string | null {
    return this.state.windowWorkspaces[windowId] || null
  }

  getCurrentWorkspace(): string | null {
    // For now, return the global workspace root
    // In multi-window mode, this would need window context
    return this.state.workspaceRoot
  }

  // Setters
  setWorkspaceRoot(root: string | null): void {
    this.setState({ workspaceRoot: root })
  }

  setWorkspaceForWindow(windowId: number, workspacePath: string): void {
    this.setState({
      windowWorkspaces: {
        ...this.state.windowWorkspaces,
        [windowId]: workspacePath,
      },
    })
  }

  addRecentFolder(folder: RecentFolder): void {
    const existing = this.state.recentFolders.filter((f) => f.path !== folder.path)
    const updated = [folder, ...existing].slice(0, MAX_RECENT_FOLDERS)
    this.setState({ recentFolders: updated })
  }

  clearRecentFolders(): void {
    this.setState({ recentFolders: [] })
  }

  // File watch management
  setFileWatchCleanup(cleanup: (() => void) | null): void {
    // Clean up previous watcher if exists
    if (this.state.fileWatchCleanup) {
      this.state.fileWatchCleanup()
    }
    this.setState({ fileWatchCleanup: cleanup })
  }

  setFileWatchEvent(event: { path: string; event: string } | null): void {
    this.setState({ fileWatchEvent: event })
  }

  // Context refresh state
  setCtxRefreshing(refreshing: boolean): void {
    this.setState({ ctxRefreshing: refreshing })
  }

  setCtxResult(result: { ok: boolean; error?: string } | null): void {
    this.setState({ ctxResult: result })
  }

  // Async operations (to be implemented with full workspace logic)
  async ensureWorkspaceReady(): Promise<{ ok: boolean; error?: string }> {
    // Placeholder - full implementation would check .hifide directories, etc.
    return { ok: true }
  }

  async hasUnsavedChanges(): Promise<boolean> {
    // Placeholder - full implementation would check git status
    return false
  }

  async openFolder(path: string): Promise<void> {
    this.setWorkspaceRoot(path)
    this.addRecentFolder({ path, lastOpened: Date.now() })
  }

  async closeWorkspace(): Promise<void> {
    this.setWorkspaceRoot(null)
  }
}

