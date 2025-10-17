/**
 * Session persistence utilities for Main Process
 * 
 * Handles saving and loading sessions from disk with debouncing and atomic writes.
 */

import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import type { Session } from '../types'

/**
 * Get the sessions directory path
 */
export async function getSessionsDir(): Promise<string> {
  const userDataPath = app.getPath('userData')
  const sessionsDir = path.join(userDataPath, 'sessions')
  await fs.mkdir(sessionsDir, { recursive: true })
  return sessionsDir
}

/**
 * Save a session to disk with atomic write
 */
export async function saveSessionToDisk(session: Session): Promise<void> {
  const sessionsDir = await getSessionsDir()
  const filePath = path.join(sessionsDir, `${session.id}.json`)
  
  // Atomic write: write to temp file, then rename
  const tempPath = `${filePath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8')
  await fs.rename(tempPath, filePath)
  
}

/**
 * Validate that a session object has the new format
 */
function isValidSession(session: any): session is Session {
  return (
    session &&
    typeof session === 'object' &&
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    Array.isArray(session.items) &&  // Must have items array (new format)
    typeof session.createdAt === 'number' &&
    typeof session.updatedAt === 'number' &&
    typeof session.lastActivityAt === 'number' &&
    session.currentContext &&
    typeof session.currentContext.provider === 'string' &&
    typeof session.currentContext.model === 'string'
  )
}

/**
 * Load a session from disk
 */
export async function loadSessionFromDisk(sessionId: string): Promise<Session | null> {
  try {
    const sessionsDir = await getSessionsDir()
    const filePath = path.join(sessionsDir, `${sessionId}.json`)
    const content = await fs.readFile(filePath, 'utf-8')
    const session = JSON.parse(content)

    // Validate session format
    if (!isValidSession(session)) {
      return null
    }

    return session
  } catch (e) {
    console.error('[session-persistence] Failed to load session:', sessionId, e)
    return null
  }
}

/**
 * Load all sessions from disk
 * Automatically filters out old/invalid format sessions
 */
export async function loadAllSessions(): Promise<Session[]> {
  try {
    const sessionsDir = await getSessionsDir()
    const files = await fs.readdir(sessionsDir)
    const sessionFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))

    const sessions: Session[] = []
    let skippedCount = 0

    for (const file of sessionFiles) {
      try {
        const content = await fs.readFile(path.join(sessionsDir, file), 'utf-8')
        const session = JSON.parse(content)

        // Validate session format - skip old/invalid sessions
        if (isValidSession(session)) {
          sessions.push(session)
        } else {
          skippedCount++
        }
      } catch (e) {
        console.error('[session-persistence] Failed to load session file:', file, e)
      }
    }

    if (skippedCount > 0) {
    }

    // Sort by updatedAt descending (most recent first)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)

    return sessions
  } catch (e) {
    console.error('[session-persistence] Failed to load sessions:', e)
    return []
  }
}

/**
 * Delete a session from disk
 */
export async function deleteSessionFromDisk(sessionId: string): Promise<void> {
  try {
    const sessionsDir = await getSessionsDir()
    const filePath = path.join(sessionsDir, `${sessionId}.json`)
    await fs.unlink(filePath)
  } catch (e) {
    console.error('[session-persistence] Failed to delete session:', sessionId, e)
    throw e
  }
}

/**
 * Debounced session saver
 * 
 * Provides debounced saving to avoid excessive disk writes.
 * Immediate saves bypass the debounce.
 */
class DebouncedSessionSaver {
  private saveTimeouts = new Map<string, NodeJS.Timeout>()
  private readonly debounceMs: number

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Save a session with optional debouncing
   */
  save(session: Session, immediate = false): void {
    // Clear existing timeout for this session
    const existingTimeout = this.saveTimeouts.get(session.id)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.saveTimeouts.delete(session.id)
    }

    if (immediate) {
      // Immediate save
      saveSessionToDisk(session).catch(e => {
        console.error('[session-persistence] Immediate save failed:', e)
      })
    } else {
      // Debounced save
      const timeout = setTimeout(() => {
        saveSessionToDisk(session).catch(e => {
          console.error('[session-persistence] Debounced save failed:', e)
        })
        this.saveTimeouts.delete(session.id)
      }, this.debounceMs)
      
      this.saveTimeouts.set(session.id, timeout)
    }
  }

  /**
   * Flush all pending saves immediately
   */
  async flushAll(): Promise<void> {
    // Clear all timeouts
    for (const timeout of this.saveTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.saveTimeouts.clear()
  }

  /**
   * Cancel all pending saves
   */
  cancelAll(): void {
    for (const timeout of this.saveTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.saveTimeouts.clear()
  }
}

// Singleton instance
export const sessionSaver = new DebouncedSessionSaver(500)

