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
import path from 'node:path'
import { startKbWatcher, stopKbWatcher } from './state.js'
import { getExplorerService, getLanguageServerService, getGitStatusService } from '../services/index.js'

export type WorkspaceId = string // absolute folder path

interface WorkspaceEntry {
  id: WorkspaceId
  windows: Set<number> // BrowserWindow.id
  refCount: number
  // Note: Kanban and KB watchers are managed internally by state.ts, not stored here
}

class WorkspaceManagerImpl {
  private workspaces = new Map<WorkspaceId, WorkspaceEntry>()
  private windowToWorkspace = new Map<number, WorkspaceId>()

  async bindWindowToWorkspace(win: BrowserWindow, workspaceId: WorkspaceId): Promise<void> {
    const normalized = this.normalizeWorkspaceId(workspaceId)
    const id = win.id
    const current = this.windowToWorkspace.get(id)
    if (current && current === normalized) return
    if (current && current !== normalized) {
      await this.unbindWindow(win)
    }
    const entry = await this.ensureEntry(normalized)
    entry.windows.add(id)
    entry.refCount += 1
    this.windowToWorkspace.set(id, normalized)
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

  private normalizeWorkspaceId(id: WorkspaceId): WorkspaceId {
    try {
      return path.resolve(id)
    } catch {
      return id
    }
  }

  private async ensureEntry(id: WorkspaceId): Promise<WorkspaceEntry> {
    const normalized = this.normalizeWorkspaceId(id)
    let entry = this.workspaces.get(normalized)
    if (!entry) {
      entry = { id: normalized, windows: new Set(), refCount: 0 }
      this.workspaces.set(normalized, entry)
      // Start watchers for this workspace
      await this.startWatchers(normalized, entry)
    }
    return entry
  }

  private async startWatchers(workspaceId: WorkspaceId, _entry: WorkspaceEntry): Promise<void> {
    try {      await startKbWatcher(workspaceId)
      // Note: entry.kbWatcher is not set because state.ts manages watchers internally
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to start KB watcher for ${workspaceId}:`, error)
    }

    try {
      const explorerService = getExplorerService()
      await explorerService.startWorkspaceWatcher(workspaceId)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to start Explorer watcher for ${workspaceId}:`, error)
    }

    try {
      const languageServerService = getLanguageServerService()
      await languageServerService.prepareWorkspace(workspaceId)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to prepare language servers for ${workspaceId}:`, error)
    }

    try {
      const gitStatusService = getGitStatusService()
      await gitStatusService.prepareWorkspace(workspaceId)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to prepare git status watcher for ${workspaceId}:`, error)
    }
  }

  private async teardownWorkspace(id: WorkspaceId): Promise<void> {
    const normalized = this.normalizeWorkspaceId(id)
    const entry = this.workspaces.get(normalized)
    if (!entry) return

    // Stop watchers
    try {      stopKbWatcher(normalized)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop KB watcher for ${normalized}:`, error)
    }

    try {
      const explorerService = getExplorerService()
      await explorerService.stopWorkspaceWatcher(normalized)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop Explorer watcher for ${normalized}:`, error)
    }

    try {
      const languageServerService = getLanguageServerService()
      await languageServerService.resetWorkspace(normalized)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop language servers for ${normalized}:`, error)
    }

    try {
      const gitStatusService = getGitStatusService()
      await gitStatusService.resetWorkspace(normalized)
    } catch (error) {
      console.error(`[WorkspaceManager] Failed to stop git status watcher for ${normalized}:`, error)
    }

    this.workspaces.delete(normalized)
    console.log(`[WorkspaceManager] Tore down workspace: ${normalized}`)
  }
}

let __instance: WorkspaceManagerImpl | null = null
export function getWorkspaceManager(): WorkspaceManagerImpl {
  if (!__instance) __instance = new WorkspaceManagerImpl()
  return __instance
}

