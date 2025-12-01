/**
 * UI RPC handlers
 *
 * Handles explorer, editor, and window controls
 * (View management and UI state moved to frontend localStorage)
 */

import { BrowserWindow } from 'electron'
import { getExplorerService } from '../../../services/index.js'
import { activeConnections, getConnectionWorkspaceId } from '../broadcast.js'
import type { RpcConnection } from '../types'

/**
 * Create UI-related RPC handlers
 */
export function createUiHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  // Explorer state
  addMethod('explorer.getState', async () => {
    try {
      const explorerService = getExplorerService()
      const workspaceRoot = await getConnectionWorkspaceId(connection)

      return {
        ok: true,
        workspaceRoot,
        openFolders: explorerService?.getOpenFolders() || [],
        childrenByDir: {}, // getChildrenByDir doesn't exist - would need to iterate and call getChildrenForDir
        openedFile: explorerService?.getOpenedFile() || null,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('explorer.toggleFolder', async ({ path }: { path: string }) => {
    try {      const explorerService = getExplorerService()
      explorerService.toggleExplorerFolder(path)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Editor
  addMethod('editor.openFile', async ({ path }: { path: string }) => {
    try {      const explorerService = getExplorerService()
      await explorerService.openFile(path)
      return { ok: true }
    } catch (e: any) {
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