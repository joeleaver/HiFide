/**
 * Planning IPC handlers
 * 
 * Handles saving and loading approved plans
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Atomic file write
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Register planning IPC handlers
 */
export function registerPlanningHandlers(ipcMain: IpcMain): void {
  /**
   * Save approved plan to .hifide-private
   */
  ipcMain.handle('planning:save-approved', async (_e, plan: any) => {
    try {
      const { useMainStore } = require('../store/index.js')
      const baseDir = path.resolve(String(useMainStore.getState().workspaceRoot || process.cwd()))
      const privateDir = path.join(baseDir, '.hifide-private')
      await ensureDir(privateDir)
      const file = path.join(privateDir, 'approved-plan.json')
      await atomicWrite(file, JSON.stringify(plan ?? {}, null, 2))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Load approved plan from .hifide-private
   */
  ipcMain.handle('planning:load-approved', async () => {
    try {
      const { useMainStore } = require('../store/index.js')
      const baseDir = path.resolve(String(useMainStore.getState().workspaceRoot || process.cwd()))
      const file = path.join(baseDir, '.hifide-private', 'approved-plan.json')
      const text = await fs.readFile(file, 'utf-8').catch(() => '')
      if (!text) return { ok: true, plan: null }
      try {
        return { ok: true, plan: JSON.parse(text) }
      } catch {
        return { ok: true, plan: null }
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
}

