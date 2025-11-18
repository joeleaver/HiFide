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

function formatShortDateTime(ts: number): string {
  const d = new Date(ts)
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

/**
 * Initial title shown when a session is created (date/time only)
 */
export function initialSessionTitle(ts?: number): string {
  return formatShortDateTime(typeof ts === 'number' ? ts : Date.now())
}

/**
 * Derive a session title from the first user message: "<date> — <short subject>"
 * If content is empty, returns date/time only.
 */
export function deriveTitle(content: string, baseTimestamp?: number): string {
  const datePart = formatShortDateTime(typeof baseTimestamp === 'number' ? baseTimestamp : Date.now())
  const s = (content || '').trim().replace(/\s+/g, ' ')
  const subject = s.slice(0, 60)
  return subject.length > 0 ? `${datePart} — ${subject}` : datePart
}

