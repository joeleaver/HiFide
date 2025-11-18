/**
 * WorkspaceManager (skeleton)
 *
 * Main-process singleton to manage multiple concurrently-open workspaces.
 * Tracks per-workspace services (indexers, watchers, schedulers) and window bindings.
 *
 * NOTE: This is a minimal skeleton to validate the architecture. Integration to
 * existing slices and WS server will follow incrementally.
 */

import { BrowserWindow } from 'electron'

export type WorkspaceId = string // absolute folder path

interface WorkspaceEntry {
  id: WorkspaceId
  windows: Set<number> // BrowserWindow.id
  refCount: number
  // Placeholders for per-workspace services
  indexer?: any
  kbIndexer?: any
  kanbanWatcher?: any
  kbWatcher?: any
}

class WorkspaceManagerImpl {
  private workspaces = new Map<WorkspaceId, WorkspaceEntry>()
  private windowToWorkspace = new Map<number, WorkspaceId>()

  bindWindowToWorkspace(win: BrowserWindow, workspaceId: WorkspaceId) {
    const id = win.id
    const entry = this.ensureEntry(workspaceId)
    entry.windows.add(id)
    entry.refCount += 1
    this.windowToWorkspace.set(id, workspaceId)
  }

  unbindWindow(win: BrowserWindow) {
    const id = win.id
    const ws = this.windowToWorkspace.get(id)
    if (!ws) return
    const entry = this.workspaces.get(ws)
    if (!entry) return
    entry.windows.delete(id)
    entry.refCount = Math.max(0, entry.refCount - 1)
    this.windowToWorkspace.delete(id)
    if (entry.refCount === 0) this.teardownWorkspace(ws)
  }

  getWorkspaceForWindow(win: BrowserWindow): WorkspaceId | undefined {
    return this.windowToWorkspace.get(win.id)
  }

  list(): WorkspaceEntry[] { return [...this.workspaces.values()] }

  private ensureEntry(id: WorkspaceId): WorkspaceEntry {
    let entry = this.workspaces.get(id)
    if (!entry) {
      entry = { id, windows: new Set(), refCount: 0 }
      this.workspaces.set(id, entry)
      // Lazy-init services will be added in later PRs
    }
    return entry
  }

  private teardownWorkspace(id: WorkspaceId) {
    const entry = this.workspaces.get(id)
    if (!entry) return
    // Stop watchers/indexers here (later PR)
    this.workspaces.delete(id)
  }
}

let __instance: WorkspaceManagerImpl | null = null
export function getWorkspaceManager(): WorkspaceManagerImpl {
  if (!__instance) __instance = new WorkspaceManagerImpl()
  return __instance
}

