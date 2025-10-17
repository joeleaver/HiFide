/**
 * Session utilities for Main Process
 */

import type { Session } from '../types'

/**
 * Load sessions from the sessions IPC handler
 * In main process, this would typically be called during initialization
 */
export async function loadSessions(): Promise<{ sessions: Session[]; currentId: string | null }> {
  try {
    // In main process, we'd load from the session manager directly
    // For now, return empty - the actual loading happens in session.slice.ts
    return { sessions: [], currentId: null }
  } catch {
    return { sessions: [], currentId: null }
  }
}

/**
 * Derive a title from message content
 */
export function deriveTitle(content: string): string {
  const s = (content || '').trim().replace(/\s+/g, ' ')
  // Take first 60 chars, ensure not empty
  const t = s.slice(0, 60)
  return t.length > 0 ? t : 'New Session'
}

