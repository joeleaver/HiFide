/**
 * Code indexing IPC handlers
 * 
 * Handles semantic code indexing, search, and index management
 */

import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { getIndexer, getWindow } from '../core/state'


/**
 * Register indexing IPC handlers
 */
export function registerIndexingHandlers(ipcMain: IpcMain): void {
  /**
   * Rebuild the code index
   */
  ipcMain.handle('index:rebuild', async () => {
    try {
      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
      
      await getIndexer().rebuild((p) => {
        try {
          wc?.send('index:progress', p)
        } catch {}
      })
      
      // Begin watching for incremental changes after a successful rebuild
      try {
        getIndexer().startWatch((p) => {
          try {
            wc?.send('index:progress', p)
          } catch {}
        })
      } catch {}
      
      // Opportunistically (re)generate context pack; won't overwrite existing
      // This is handled by the workspace module to avoid circular dependencies
      
      return { ok: true, status: getIndexer().status() }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Get index status
   */
  ipcMain.handle('index:status', async () => {
    try {
      return { ok: true, status: getIndexer().status() }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Cancel ongoing index operation
   */
  ipcMain.handle('index:cancel', async () => {
    try {
      getIndexer().cancel()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Clear the index
   */
  ipcMain.handle('index:clear', async () => {
    try {
      getIndexer().clear()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Search the code index
   */
  ipcMain.handle('index:search', async (_e, args: { query: string; k?: number }) => {
    try {
      const res = await getIndexer().search(args.query, args.k ?? 8)
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

