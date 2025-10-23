/**
 * Workspace and project management IPC handlers
 * 
 * Handles workspace root management, folder dialogs, and project bootstrapping
 */

import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getIndexer, resetIndexer, windowStateStore } from '../core/state'
import { buildMenu } from './menu'

/**
 * Check if a path exists
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure directory exists
 */
async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}



/**
 * Atomic file write
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}


/**
 * Get workspace settings file path
 */
async function getSettingsPath(): Promise<string> {
  const { useMainStore } = await import('../store/index.js')
  const baseDir = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
  const privateDir = path.join(baseDir, '.hifide-private')
  return path.join(privateDir, 'settings.json')
}

/**
 * Load workspace settings
 */
export async function loadWorkspaceSettings(): Promise<Record<string, any>> {
  try {
    const settingsPath = await getSettingsPath()
    const content = await fs.readFile(settingsPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Save workspace settings
 */
export async function saveWorkspaceSettings(settings: Record<string, any>): Promise<void> {
  const settingsPath = await getSettingsPath()
  const privateDir = path.dirname(settingsPath)
  await ensureDir(privateDir)
  await atomicWrite(settingsPath, JSON.stringify(settings, null, 2))
}

/**
 * Register workspace IPC handlers
 */
export function registerWorkspaceHandlers(ipcMain: IpcMain): void {
  /**
   * Get workspace root
   */
  ipcMain.handle('workspace:get-root', async () => {
    const { useMainStore } = await import('../store/index.js')
    return useMainStore.getState().workspaceRoot || process.cwd()
  })

  /**
   * Set workspace root
   * NOTE: This is deprecated - use the store's setWorkspaceRoot action instead
   */
  ipcMain.handle('workspace:set-root', async (_e, newRoot: string) => {
    try {
      const resolved = path.resolve(newRoot)
      // Verify the directory exists
      await fs.access(resolved)

      // Update store (single source of truth)
      const { useMainStore } = await import('../store/index.js')
      useMainStore.getState().setWorkspaceRoot(resolved)

      // Reinitialize indexer with new root
      resetIndexer()
      await getIndexer()

      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Open folder dialog
   */
  ipcMain.removeHandler('workspace:open-folder-dialog') // Prevent duplicates during hot reload
  ipcMain.handle('workspace:open-folder-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Folder',
        buttonLabel: 'Open'
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, canceled: true }
      }

      return { ok: true, path: result.filePaths[0] }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Sync recent folders from renderer
   */
  ipcMain.on('workspace:recent-folders-changed', (_e, recentFolders: Array<{ path: string; lastOpened: number }>) => {
    try {
      windowStateStore.set('recentFolders', recentFolders)
    } catch (e) {
      console.error('[workspace] Failed to save recent folders:', e)
    }
    buildMenu()
  })

  /**
   * Bootstrap workspace with .hifide-public and .hifide-private
   */
  ipcMain.handle('workspace:bootstrap', async (_e, args: { baseDir?: string; preferAgent?: boolean; overwrite?: boolean }) => {
    try {
      const { useMainStore } = await import('../store/index.js')
      const baseDir = path.resolve(String(args?.baseDir || useMainStore.getState().workspaceRoot || process.cwd()))
      const res = await useMainStore.getState().ensureWorkspaceReady?.({
        baseDir,
        preferAgent: !!args?.preferAgent,
        overwrite: !!args?.overwrite,
      })
      return res || { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Ensure directory exists
   */
  ipcMain.removeHandler('workspace:ensure-directory')
  ipcMain.handle('workspace:ensure-directory', async (_e, dirPath: string) => {
    try {
      await ensureDir(dirPath)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Check if file exists
   */
  ipcMain.removeHandler('workspace:file-exists')
  ipcMain.handle('workspace:file-exists', async (_e, filePath: string) => {
    try {
      const exists = await pathExists(filePath)
      return exists
    } catch (error) {
      return false
    }
  })

  /**
   * Read file content
   */
  ipcMain.removeHandler('workspace:read-file')
  ipcMain.handle('workspace:read-file', async (_e, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { ok: true, content }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Write file content
   */
  ipcMain.removeHandler('workspace:write-file')
  ipcMain.handle('workspace:write-file', async (_e, filePath: string, content: string) => {
    try {
      await atomicWrite(filePath, content)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * List files in directory
   */
  ipcMain.removeHandler('workspace:list-files')
  ipcMain.handle('workspace:list-files', async (_e, dirPath: string) => {
    try {
      const files = await fs.readdir(dirPath)
      return { ok: true, files }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Get workspace settings
   */
  ipcMain.removeHandler('workspace:get-settings')
  ipcMain.handle('workspace:get-settings', async () => {
    try {
      const settings = await loadWorkspaceSettings()
      return { ok: true, settings }
    } catch (error) {
      return { ok: false, error: String(error), settings: {} }
    }
  })

  /**
   * Set workspace setting
   */
  ipcMain.removeHandler('workspace:set-setting')
  ipcMain.handle('workspace:set-setting', async (_e, key: string, value: any) => {
    try {
      const settings = await loadWorkspaceSettings()
      settings[key] = value
      await saveWorkspaceSettings(settings)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
}

