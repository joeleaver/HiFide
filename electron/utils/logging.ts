/**
 * PTY logging utilities for the Electron main process
 * 
 * Provides event logging for PTY sessions
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { PtyLogEvent } from '../types'

/**
 * Get the root directory for PTY logs
 */
export function logsRoot(): string {
  return path.join(app.getPath('userData'), 'logs', 'pty')
}

/**
 * Ensure the logs directory exists
 */
export async function ensureLogsDir(): Promise<void> {
  await fs.mkdir(logsRoot(), { recursive: true })
}

/**
 * Log a PTY event to disk
 * 
 * @param sessionId - PTY session ID
 * @param type - Event type
 * @param payload - Event payload
 */
export async function logEvent(sessionId: string, type: string, payload: any): Promise<void> {
  try {
    await ensureLogsDir()
    
    const entry: PtyLogEvent = {
      ts: new Date().toISOString(),
      sessionId,
      type,
      ...payload
    }
    
    const logFile = path.join(logsRoot(), `${sessionId}.jsonl`)
    await fs.appendFile(logFile, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (error) {
    // Silently fail - logging should not break functionality
    console.error('[logging] Failed to log event:', error)
  }
}

