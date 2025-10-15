/**
 * Session persistence IPC handlers
 * 
 * Handles loading, saving, and deleting chat sessions from the workspace
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Get the sessions directory path (workspace-relative)
 */
async function getSessionsDir(): Promise<string> {
  const baseDir = path.resolve(process.env.APP_ROOT || process.cwd())
  const privateDir = path.join(baseDir, '.hifide-private')
  const sessionsDir = path.join(privateDir, 'sessions')

  // Ensure directories exist
  try {
    await fs.mkdir(privateDir, { recursive: true })
    await fs.mkdir(sessionsDir, { recursive: true })
  } catch (e) {
    // Ignore if already exists
  }

  return sessionsDir
}

/**
 * Atomic file write
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Register sessions IPC handlers
 */
export function registerSessionsHandlers(ipcMain: IpcMain): void {
  /**
   * List all sessions
   */
  ipcMain.handle('sessions:list', async () => {
    try {
      const sessionsDir = await getSessionsDir()
      const files = await fs.readdir(sessionsDir)
      const sessionFiles = files.filter(f => f.endsWith('.json'))

      const sessions = await Promise.all(
        sessionFiles.map(async (file) => {
          try {
            const filePath = path.join(sessionsDir, file)
            const content = await fs.readFile(filePath, 'utf-8')
            return JSON.parse(content)
          } catch (e) {
            return null
          }
        })
      )

      // Filter out nulls and sort by updatedAt descending
      const validSessions = sessions
        .filter(s => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)

      return { ok: true, sessions: validSessions }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Load a specific session
   */
  ipcMain.handle('sessions:load', async (_e, sessionId: string) => {
    try {
      const sessionsDir = await getSessionsDir()
      const filePath = path.join(sessionsDir, `${sessionId}.json`)
      const content = await fs.readFile(filePath, 'utf-8')
      const session = JSON.parse(content)
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Save a session
   */
  ipcMain.handle('sessions:save', async (_e, session: any) => {
    try {
      const sessionsDir = await getSessionsDir()
      const filePath = path.join(sessionsDir, `${session.id}.json`)
      await atomicWrite(filePath, JSON.stringify(session, null, 2))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Delete a session
   */
  ipcMain.handle('sessions:delete', async (_e, sessionId: string) => {
    try {
      const sessionsDir = await getSessionsDir()
      const filePath = path.join(sessionsDir, `${sessionId}.json`)
      await fs.unlink(filePath)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
}

