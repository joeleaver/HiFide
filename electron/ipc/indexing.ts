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

      const indexer = await getIndexer()
      await indexer.rebuild((p) => {
        try {
          wc?.send('index:progress', p)
        } catch {}
      })

      // Begin watching for incremental changes after a successful rebuild
      try {
        indexer.startWatch((p) => {
          try {
            wc?.send('index:progress', p)
          } catch {}
        })
      } catch {}

      // Opportunistically (re)generate context pack; won't overwrite existing
      // This is handled by the workspace module to avoid circular dependencies

      return { ok: true, status: indexer.status() }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Get index status
   */
  ipcMain.handle('index:status', async () => {
    try {
      const indexer = await getIndexer()
      return { ok: true, status: indexer.status() }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Cancel ongoing index operation
   */
  ipcMain.handle('index:cancel', async () => {
    try {
      const indexer = await getIndexer()
      indexer.cancel()
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
      const indexer = await getIndexer()
      indexer.clear()
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
      const indexer = await getIndexer()
      const res = await indexer.search(args.query, args.k ?? 8)
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

