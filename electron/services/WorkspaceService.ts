/**
 * Workspace Service
 * 
 * Manages workspace root, multi-window support, and recent folders.
 */

import { Service } from './base/Service.js'
import type { RecentFolder } from '../store/types.js'
import { MAX_RECENT_FOLDERS } from '../../src/store/utils/constants'
import { buildMenu } from '../ipc/menu.js'

interface WorkspaceState {
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
    // Persist workspace state (use persistState to save entire state to 'workspace' key)
    if (updates.recentFolders !== undefined || updates.windowWorkspaces !== undefined) {
      this.persistState()
    }

    if (updates.recentFolders !== undefined) {
      this.events.emit('recentFolders:changed', this.state.recentFolders)

      // Rebuild menu when recent folders change
      try {
        buildMenu()
      } catch (err) {
        console.error(err)
      }
    }
  }

  // Getters
  getRecentFolders(): RecentFolder[] {
    return [...this.state.recentFolders]
  }

  getWorkspaceForWindow(windowId: number): string | null {
    return this.state.windowWorkspaces[windowId] || null
  }

  getAllWindowWorkspaces(): Record<number, string> {
    return { ...this.state.windowWorkspaces }
  }

  // Setters
  setWorkspaceForWindow(windowId: number, workspacePath: string): void {
    this.setState({
      windowWorkspaces: {
        ...this.state.windowWorkspaces,
        [windowId]: workspacePath,
      },
    })
  }

  removeWorkspaceForWindow(windowId: number): void {
    const { [windowId]: _, ...rest } = this.state.windowWorkspaces
    this.setState({ windowWorkspaces: rest })
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

  async hasUnsavedChanges(): Promise<boolean> {
    // Placeholder - full implementation would check git status
    return false
  }

  async openFolder(path: string, windowId: number): Promise<void> {
    this.setWorkspaceForWindow(windowId, path)
    this.addRecentFolder({ path, lastOpened: Date.now() })
  }

  async closeWorkspace(windowId: number): Promise<void> {
    this.removeWorkspaceForWindow(windowId)
  }
}

