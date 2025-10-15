import type { Session } from '../types'
import { LS_KEYS } from './constants'

export async function loadSessions(): Promise<{ sessions: Session[]; currentId: string | null }> {
  try {
    const listed = await (window.sessions?.list?.() as Promise<{ ok: boolean; sessions?: Session[] } | undefined>)
    let sessions = (listed && listed.ok && Array.isArray(listed.sessions)) ? (listed.sessions as Session[]) : []

    // Ensure backward compatibility - add toolCalls field if missing
    sessions = sessions.map(session => ({
      ...session,
      toolCalls: session.toolCalls || []
    }))

    const currentId = (typeof localStorage !== 'undefined') ? (localStorage.getItem(LS_KEYS.CURRENT_SESSION_ID) as string | null) : null
    return { sessions, currentId }
  } catch {
    return { sessions: [], currentId: null }
  }
}

export function deriveTitle(content: string): string {
  const s = (content || '').trim().replace(/\s+/g, ' ')
  // Take first 60 chars, ensure not empty
  const t = s.slice(0, 60)
  return t.length > 0 ? t : 'New Chat'
}

