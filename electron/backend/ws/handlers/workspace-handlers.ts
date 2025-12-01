/**
 * Workspace RPC handlers
 *
 * Handles workspace operations, folder management, settings, and workspace hydration
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'
import { getWorkspaceService } from '../../../services/index.js'
import { getConnectionWorkspaceId, activeConnections } from '../broadcast.js'
import { sendWorkspaceSnapshot } from '../snapshot.js'
import { loadWorkspace } from '../workspace-loader.js'
import type { RpcConnection } from '../types'

/**
 * Create workspace-related RPC handlers
 */
export function createWorkspaceHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  // Workspace get/open/hydrate
  addMethod('workspace.get', async () => {
    try {
      // Return the workspace bound to this connection
      const bound = await getConnectionWorkspaceId(connection)
      if (bound) return { ok: true, id: bound, workspaceId: bound, root: bound }
      return { ok: true, id: null, workspaceId: null, root: null }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('workspace.open', async ({ root }: { root: string }) => {
    try {      // Normalize path for consistent workspace identity
      const requestedRaw = String(root)
      const requested = path.resolve(requestedRaw)

      const workspaceService = getWorkspaceService()

      // If another window already has this workspace open, just join it in this window
      let alreadyOpen = false
      let existingWinId: number | null = null

      try {
        for (const [conn, meta] of activeConnections.entries()) {
          if (conn !== connection && meta.windowId) {
            const connWorkspace = workspaceService.getWorkspaceForWindow(meta.windowId)
            if (connWorkspace && path.resolve(connWorkspace) === requested) {
              alreadyOpen = true
              existingWinId = meta.windowId
              break
            }
          }
        }
      } catch { }

      if (alreadyOpen && existingWinId) {
        try {
          const bw = BrowserWindow.fromId(existingWinId)
          try { bw?.show() } catch { }
          try { if (bw?.isMinimized()) bw.restore() } catch { }
          try { bw?.focus() } catch { }

          // Close self window
          const selfMeta = activeConnections.get(connection)
          if (selfMeta?.windowId) {
            const selfBw = BrowserWindow.fromId(selfMeta.windowId)
            setTimeout(() => { try { selfBw?.close() } catch { } }, 50)
          }
        } catch { }
        return { ok: true, focused: true }
      }

      // Kick off workspace loading in the background using consolidated loader
      const meta = activeConnections.get(connection)
      if (!meta?.windowId) {
        return { ok: false, error: 'No window ID bound to connection' }
      }

      loadWorkspace({
        workspaceId: requested,
        connection,
        windowId: String(meta.windowId),
        background: true
      })

      // Return quickly so the UI can render a per-window loading overlay
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('workspace.hydrate', async () => {
    try {
      const bound = await getConnectionWorkspaceId(connection)
      if (!bound) return { ok: true, workspace: null }

      await sendWorkspaceSnapshot(connection, bound)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('workspace.hydrateStrict', async () => {
    try {
      const bound = await getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }

      await sendWorkspaceSnapshot(connection, bound)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Recent folders
  addMethod('workspace.clearRecentFolders', async () => {
    try {      const workspaceService = getWorkspaceService()
      workspaceService.clearRecentFolders()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('workspace.listRecentFolders', async () => {
    try {      const workspaceService = getWorkspaceService()
      const folders = workspaceService.getRecentFolders() || []
      return { ok: true, folders }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Folder dialog
  addMethod('workspace.openFolderDialog', async () => {
    try {      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Folder',
        buttonLabel: 'Open'
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, canceled: true }
      }

      return { ok: true, path: result.filePaths[0] }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Workspace settings
  addMethod('workspace.getSettings', async () => {
    try {
      const root = await getConnectionWorkspaceId(connection)
      if (!root) return { ok: true, settings: {} }
      const settingsPath = path.join(root, '.hifide-private', 'settings.json')

      try {
        const content = await fs.readFile(settingsPath, 'utf-8')
        const settings = JSON.parse(content)
        return { ok: true, settings }
      } catch {
        return { ok: true, settings: {} }
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e), settings: {} }
    }
  })

  addMethod('workspace.setSetting', async ({ key, value }: { key: string; value: any }) => {
    try {
      const root = await getConnectionWorkspaceId(connection)
      if (!root) return { ok: false, error: 'no-workspace' }
      const settingsPath = path.join(root, '.hifide-private', 'settings.json')

      let settings: any = {}
      try {
        const content = await fs.readFile(settingsPath, 'utf-8')
        settings = JSON.parse(content)
      } catch {
        // File doesn't exist yet, start with empty object
      }

      settings[key] = value
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Recent folders management
  addMethod('workspace.clearRecentFolders', async () => {
    try {      const workspaceService = getWorkspaceService()
      workspaceService.clearRecentFolders()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('workspace.listRecentFolders', async () => {
    try {      const workspaceService = getWorkspaceService()
      const items = workspaceService.getRecentFolders()
      return { ok: true, recentFolders: items, folders: items }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}
