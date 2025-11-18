/**
 * Session persistence utilities for Main Process
 *
 * Handles saving and loading sessions from disk with debouncing and atomic writes.
 */

import fs from 'fs/promises'
import path from 'path'

import type { Session } from '../types'



/**
 * Get the sessions directory path
 */
export async function getSessionsDir(workspaceRoot?: string): Promise<string> {
  // Resolve workspace-relative sessions directory
  const { useMainStore } = await import('../index')

  // <workspaceRoot>/.hifide-private/sessions
  const baseDir = path.resolve(
    workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  )
  const privateDir = path.join(baseDir, '.hifide-private')
  const sessionsDir = path.join(privateDir, 'sessions')
  try { await fs.mkdir(privateDir, { recursive: true }) } catch {}
  try { await fs.mkdir(sessionsDir, { recursive: true }) } catch {}
  return sessionsDir
}

/**
 * Save a session to disk with atomic write
 * Uses a unique temp file to prevent race conditions
 * Handles Windows file locking issues with retry logic
 */
export async function saveSessionToDisk(session: Session): Promise<void> {
  const sessionsDir = await getSessionsDir()
  const filePath = path.join(sessionsDir, `${session.id}.json`)

  // Atomic write: write to temp file with unique suffix, then rename
  // Use timestamp + random to ensure uniqueness and prevent race conditions
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`

  try {
    await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8')

    // On Windows, rename can fail with EPERM if destination is locked
    // Retry a few times with exponential backoff
    let lastError: any
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // On Windows, we need to delete the destination first if it exists
        // This is safe because we've already written the new data to tempPath
        if (process.platform === 'win32') {
          try {
            await fs.unlink(filePath)
          } catch (e: any) {
            // Ignore ENOENT (file doesn't exist yet)
            if (e.code !== 'ENOENT') {
              throw e
            }
          }
        }

        await fs.rename(tempPath, filePath)
        return // Success!
      } catch (error: any) {
        lastError = error

        // Only retry on EPERM/EBUSY (file locked)
        if (error.code !== 'EPERM' && error.code !== 'EBUSY') {
          throw error
        }

        // Wait before retry (exponential backoff: 10ms, 50ms, 250ms)
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(5, attempt)))
        }
      }
    }

    // All retries failed
    throw lastError
  } catch (error) {
    // Clean up temp file if write/rename failed
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
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
 * Attempt to upgrade legacy session formats to the new schema with items[] timeline.
 * Returns upgraded Session or null if not recognized.
 */
function upgradeLegacySession(session: any): Session | null {
  try {
    if (!session || typeof session !== 'object') return null

    const id = typeof session.id === 'string' ? session.id : null
    if (!id) return null

    const title = typeof session.title === 'string' ? session.title : `Session ${new Date().toLocaleString()}`

    // Try to find messages in legacy locations
    const ctx = session.currentContext || {}
    const legacyMsgs: any[] = Array.isArray(ctx.messageHistory)
      ? ctx.messageHistory
      : Array.isArray(session.messageHistory)
        ? session.messageHistory
        : Array.isArray(session.messages)
          ? session.messages
          : []

    const now = Date.now()
    const createdAt = typeof session.createdAt === 'number' ? session.createdAt : now
    const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : now
    const lastActivityAt = typeof session.lastActivityAt === 'number' ? session.lastActivityAt : updatedAt

    // Provider/model fallback if missing
    const provider = typeof ctx.provider === 'string' ? ctx.provider : (typeof session.provider === 'string' ? session.provider : 'openai')
    const model = typeof ctx.model === 'string' ? ctx.model : (typeof session.model === 'string' ? session.model : 'gpt-4o-mini')

    // If items already exists but is not an array, or empty, we can populate from legacy messages
    const items: any[] = []

    // Map legacy messages to timeline 'message' items (only user/assistant)
    if (Array.isArray(legacyMsgs) && legacyMsgs.length) {
      let ts = createdAt
      for (const m of legacyMsgs) {
        const role = (m?.role === 'user' || m?.role === 'assistant') ? m.role : null
        const content = typeof m?.content === 'string' ? m.content
          : Array.isArray(m?.content) ? m.content.map((seg: any) => {
              if (typeof seg === 'string') return seg
              if (seg && typeof seg.text === 'string') return seg.text
              return ''
            }).join('')
          : ''
        if (!role || !content) continue
        const mid = (m?.metadata?.id && typeof m.metadata.id === 'string') ? m.metadata.id : `msg-${ts}`
        const timestamp = typeof m?.timestamp === 'number' ? m.timestamp : ts
        items.push({ type: 'message', id: mid, role, content, timestamp })
        ts += 1
      }
    }

    // If we still have no items, but there is a single last message stored differently, skip

    // Build upgraded session
    const upgraded: Session = {
      id,
      title,
      items: Array.isArray(session.items) && session.items.length ? session.items : items,
      createdAt,
      updatedAt,
      lastActivityAt,
      currentContext: {
        provider,
        model,
        systemInstructions: typeof ctx.systemInstructions === 'string' ? ctx.systemInstructions : undefined,
        temperature: typeof ctx.temperature === 'number' ? ctx.temperature : undefined,
        messageHistory: Array.isArray(ctx.messageHistory) ? ctx.messageHistory : undefined,
      },
      tokenUsage: (session.tokenUsage && typeof session.tokenUsage === 'object') ? session.tokenUsage : { byProvider: {}, byProviderAndModel: {}, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      costs: (session.costs && typeof session.costs === 'object') ? session.costs : { byProviderAndModel: {}, totalCost: 0, currency: 'USD' },
    }

    // Must have items array to be valid after upgrade (can be empty if truly no history)
    if (!Array.isArray(upgraded.items)) upgraded.items = []

    return upgraded
  } catch {
    return null
  }
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

    // Validate session format; attempt legacy upgrade if needed
    if (!isValidSession(session)) {
      const upgraded = upgradeLegacySession(session)
      if (upgraded) {
        try { sessionSaver.save(upgraded, true) } catch {}
        return upgraded
      }
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
export async function loadAllSessions(workspaceRoot?: string): Promise<Session[]> {
  try {
    const sessionsDir = await getSessionsDir(workspaceRoot)
    const files = await fs.readdir(sessionsDir)
    const sessionFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))

    const sessions: Session[] = []
    let skippedCount = 0

    for (const file of sessionFiles) {
      try {
        const content = await fs.readFile(path.join(sessionsDir, file), 'utf-8')
        const session = JSON.parse(content)

        // Validate session format - attempt upgrade for old/invalid sessions
        if (isValidSession(session)) {
          sessions.push(session)
        } else {
          const upgraded = upgradeLegacySession(session)
          if (upgraded) {
            sessions.push(upgraded)
            try { sessionSaver.save(upgraded, true) } catch {}
          } else {
            skippedCount++
          }
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
 * Also prevents concurrent saves to the same session.
 * Immediate saves bypass the debounce.
 */
class DebouncedSessionSaver {
  private saveTimeouts = new Map<string, NodeJS.Timeout>()
  private activeSaves = new Map<string, Promise<void>>()
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
      // Immediate save - but wait for any active save to complete first
      this.performSave(session)
    } else {
      // Debounced save
      const timeout = setTimeout(() => {
        this.performSave(session)
        this.saveTimeouts.delete(session.id)
      }, this.debounceMs)

      this.saveTimeouts.set(session.id, timeout)
    }
  }

  /**
   * Perform the actual save, preventing concurrent saves to the same session
   */
  private async performSave(session: Session): Promise<void> {
    // Wait for any active save to complete
    const activeSave = this.activeSaves.get(session.id)
    if (activeSave) {
      await activeSave.catch(() => {
        // Ignore errors from previous save
      })
    }

    // Start new save
    const savePromise = saveSessionToDisk(session)
      .catch(e => {
        console.error('[session-persistence] Save failed:', e)
      })
      .finally(() => {
        // Clean up active save tracking
        if (this.activeSaves.get(session.id) === savePromise) {
          this.activeSaves.delete(session.id)
        }
      })

    this.activeSaves.set(session.id, savePromise)
    await savePromise
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

