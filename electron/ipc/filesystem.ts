/**
 * File system operations IPC handlers
 * 
 * Handles file reading, directory listing, and directory watching
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { getWindow } from '../core/state'
import type { FileWatchRecord, FileSystemEvent } from '../types'

/**
 * Directory watch management
 */
let nextWatchId = 1
const activeWatches = new Map<number, FileWatchRecord>()

/**
 * Send file system event to renderer
 */
function sendFsEvent(payload: FileSystemEvent): void {
  try {
    getWindow()?.webContents.send('fs:watch:event', payload)
  } catch {}
}

/**
 * Add watchers recursively to a directory tree
 * 
 * On Linux, we need to manually watch each subdirectory.
 * On macOS/Windows, recursive watching is supported natively.
 */
async function addWatchersRecursively(
  root: string,
  onEvent: (dir: string, type: 'rename' | 'change', filename?: string) => void
): Promise<() => void> {
  const watchers: fsSync.FSWatcher[] = []
  const isLinux = process.platform === 'linux'
  
  const mkWatcher = (dirPath: string) => {
    const watcher = fsSync.watch(
      dirPath,
      // recursive is only reliably supported on darwin/win32
      isLinux ? undefined : { recursive: true },
      (eventType, filename) => onEvent(dirPath, eventType, typeof filename === 'string' ? filename : undefined)
    )
    watchers.push(watcher)
  }

  let dirCount = 0
  const walk = async (dirPath: string) => {
    mkWatcher(dirPath)
    dirCount++

    // Yield to event loop every 50 directories to prevent blocking
    if (dirCount % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }

    if (!isLinux) return // recursive handles subdirs
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          const child = path.join(dirPath, e.name)
          await walk(child)
        }
      }
    } catch {}
  }
  await walk(root)

  return () => {
    for (const w of watchers) {
      try {
        w.close()
      } catch {}
    }
  }
}

/**
 * Register filesystem IPC handlers
 */
export function registerFilesystemHandlers(ipcMain: IpcMain): void {
  /**
   * Get current working directory
   */
  ipcMain.handle('fs:getCwd', async () => {
    return process.cwd()
  })

  /**
   * Read file contents
   */
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Read directory entries
   */
  ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return {
        success: true,
        entries: entries.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(dirPath, entry.name)
        }))
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Start watching a directory for changes
   */
  ipcMain.handle('fs:watchStart', async (_e, dirPath: string) => {
    try {
      const id = nextWatchId++
      const close = await addWatchersRecursively(dirPath, (dir, type, filename) => {
        const full = filename ? path.join(dir, filename) : dir
        sendFsEvent({ id, type: (type as any) || 'change', path: full, dir })
      })
      activeWatches.set(id, { close })
      return { success: true, id }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Stop watching a directory
   */
  ipcMain.handle('fs:watchStop', async (_e, id: number) => {
    const rec = activeWatches.get(id)
    if (!rec) return { success: false }
    try {
      rec.close()
      activeWatches.delete(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}

