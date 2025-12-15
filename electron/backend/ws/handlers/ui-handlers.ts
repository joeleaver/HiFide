/**
 * UI RPC handlers
 *
 * Handles explorer, editor, and window controls
 * (View management and UI state moved to frontend localStorage)
 */

import { BrowserWindow } from 'electron'
import { getExplorerService, getGitStatusService, getWorkspaceSearchService } from '../../../services/index.js'
import { activeConnections, getConnectionWorkspaceId } from '../broadcast.js'
import type { RpcConnection } from '../types'
import type { RendererMenuStatePayload } from '../../../../shared/menu.js'
import { updateRendererMenuState } from '../../../ipc/menu.js'
import { SEARCH_NOTIFICATION_DONE, SEARCH_NOTIFICATION_RESULTS, type WorkspaceReplaceRequest, type WorkspaceSearchParams } from '../../../../shared/search.js'

/**
 * Create UI-related RPC handlers
 */
export function createUiHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  const workspaceSearchService = getWorkspaceSearchService()
  let activeSearchHandle: { id: string; cancel: () => void } | null = null

  // Explorer state
  addMethod('explorer.getState', async () => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) {
        return { ok: false, error: 'no-workspace' }
      }

      const explorerService = getExplorerService()
      try { await explorerService.startWorkspaceWatcher(workspaceRoot) } catch {}
      await explorerService.loadExplorerDir(workspaceRoot, workspaceRoot)
      const snapshot = explorerService.getWorkspaceSnapshot(workspaceRoot)

      return {
        ok: true,
        workspaceRoot,
        openFolders: snapshot.openFolders,
        childrenByDir: snapshot.childrenByDir,
        openedFile: snapshot.openedFile,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('explorer.toggleFolder', async ({ path }: { path: string }) => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) {
        return { ok: false, error: 'no-workspace' }
      }

      const explorerService = getExplorerService()
      const snapshot = await explorerService.toggleExplorerFolder(workspaceRoot, path)
      return { ok: true, openFolders: snapshot.openFolders, childrenByDir: snapshot.childrenByDir }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('explorer.listDir', async ({ path, includeStats }: { path?: string; includeStats?: boolean } = {}) => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) {
        return { ok: false, error: 'no-workspace' }
      }

      const explorerService = getExplorerService()
      const entries = await explorerService.listDirectory(workspaceRoot, path ?? workspaceRoot, { includeStats })
      return { ok: true, workspaceRoot, entries }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod(
    'explorer.createEntry',
    async ({ parentDir, name, type, content }: { parentDir: string; name: string; type: 'file' | 'folder'; content?: string }) => {
      try {
        if (!parentDir || !name) return { ok: false, error: 'parent-and-name-required' }
        const workspaceRoot = await getConnectionWorkspaceId(connection)
        if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

        const explorerService = getExplorerService()
        const result = await explorerService.createEntry(workspaceRoot, parentDir, name, { type: type ?? 'file', content })
        return { ok: true, entry: result }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
  )

  addMethod('explorer.renameEntry', async ({ path, name }: { path: string; name: string }) => {
    try {
      if (!path || !name) return { ok: false, error: 'path-and-name-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      const result = await explorerService.renameEntry(workspaceRoot, path, name)
      return { ok: true, entry: result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('explorer.deleteEntry', async ({ path }: { path: string }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      await explorerService.deleteEntry(workspaceRoot, path)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('explorer.duplicateEntry', async ({ path }: { path: string }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      const result = await explorerService.duplicateEntry(workspaceRoot, path)
      return { ok: true, entry: result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod(
    'explorer.pasteEntries',
    async ({ sources, destination, mode }: { sources: string[]; destination: string; mode?: 'copy' | 'cut' }) => {
      try {
        if (!Array.isArray(sources) || !sources.length) return { ok: false, error: 'sources-required' }
        const workspaceRoot = await getConnectionWorkspaceId(connection)
        if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

        const explorerService = getExplorerService()
        const result = await explorerService.pasteEntries(workspaceRoot, sources, destination, { mode })
        return { ok: true, entries: result }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
  )

  addMethod('explorer.readFile', async ({ path, encoding }: { path: string; encoding?: BufferEncoding }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      const file = await explorerService.readFile(workspaceRoot, path, encoding)
      return { ok: true, file }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('git.getStatus', async () => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const gitStatusService = getGitStatusService()
      const snapshot = await gitStatusService.getStatusSnapshot(workspaceRoot, { refresh: true })
      return { ok: true, snapshot }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('search.workspace.run', async ({ params }: { params: WorkspaceSearchParams }) => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      if (activeSearchHandle) {
        try { activeSearchHandle.cancel() } catch {}
        activeSearchHandle = null
      }

      const handle = await workspaceSearchService.startWorkspaceSearch(workspaceRoot, params ?? {}, {
        onBatch: (payload) => {
          if (activeSearchHandle?.id !== payload.searchId) return
          try { connection.sendNotification(SEARCH_NOTIFICATION_RESULTS, payload) } catch {}
        },
        onDone: (payload) => {
          if (activeSearchHandle?.id === payload.searchId) {
            activeSearchHandle = null
          }
          try { connection.sendNotification(SEARCH_NOTIFICATION_DONE, payload) } catch {}
        },
      })

      activeSearchHandle = handle
      return { ok: true, searchId: handle.id }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('search.workspace.cancel', async () => {
    try {
      if (activeSearchHandle) {
        try { activeSearchHandle.cancel() } catch {}
        activeSearchHandle = null
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('search.workspace.replace', async (payload: WorkspaceReplaceRequest) => {
    try {
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
      if (!payload || !Array.isArray(payload.operations) || payload.operations.length === 0) {
        return { ok: false, error: 'no-operations' }
      }
      const result = await workspaceSearchService.applyWorkspaceReplacements(workspaceRoot, payload)
      return { ok: true, result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Editor
  addMethod('editor.openFile', async ({ path }: { path: string }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      const openedFile = await explorerService.openFile(workspaceRoot, path)
      return { ok: true, openedFile }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('editor.saveFile', async ({ path, content, encoding }: { path: string; content: string; encoding?: BufferEncoding }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await getConnectionWorkspaceId(connection)
      if (!workspaceRoot) return { ok: false, error: 'no-workspace' }

      const explorerService = getExplorerService()
      const saved = await explorerService.writeFile(workspaceRoot, path, content ?? '', encoding)
      return { ok: true, saved }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('menu.updateState', async ({ state }: { state: RendererMenuStatePayload }) => {
    try {
      if (!state || typeof state !== 'object') {
        return { ok: false, error: 'state-required' }
      }
      updateRendererMenuState(state)
      return { ok: true }
    } catch (e: any) {
      console.warn('[menu.updateState] Failed to apply menu state:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Window controls
  addMethod('window.setContentSize', async ({ width, height }: { width: number; height: number }) => {
    try {      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      const newWidth = Math.max(400, Math.min(3840, width))
      const newHeight = Math.max(300, Math.min(2160, height))

      win.setContentSize(newWidth, newHeight, true)
      return { ok: true, width: newWidth, height: newHeight }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('window.setMinimumSize', async ({ width, height }: { width: number; height: number }) => {
    try {
      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      const minWidth = Math.max(200, Math.min(3840, Math.floor(width)))
      const minHeight = Math.max(200, Math.min(2160, Math.floor(height)))

      win.setMinimumSize(minWidth, minHeight)
      return { ok: true, width: minWidth, height: minHeight }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
 
  addMethod('window.minimize', async () => {
    try {      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      win.minimize()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('window.toggleMaximize', async () => {
    try {      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      if (win.isMaximized()) {
        win.unmaximize()
        return { ok: true, maximized: false }
      } else {
        win.maximize()
        return { ok: true, maximized: true }
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('window.maximize', async () => {
    try {      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      win.maximize()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('window.close', async () => {
    try {      const meta = activeConnections.get(connection)
      if (!meta?.windowId) return { ok: false, error: 'no-window' }

      const win = BrowserWindow.fromId(meta.windowId)
      if (!win) return { ok: false, error: 'window-not-found' }

      win.close()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('app.getBootStatus', async () => {
    try {
      // Boot status is not tracked - return a default
      return { ok: true, status: 'ready' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}