/**
 * Shared utility for resolving workspace from session ID
 * Used by both flows-v2 and WebSocket server
 */

import { getSessionService } from '../services/index.js'

/**
 * Find which workspace contains a given session ID
 * @param sessionId The session ID to look up
 * @returns The workspace ID (absolute path) or null if not found
 */
export function getWorkspaceIdForSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null
  try {
    const sessionService = getSessionService()
    const state = sessionService.getState()
    const map = state.sessionsByWorkspace || {}
    for (const [ws, list] of Object.entries(map as Record<string, any[]>)) {
      if (Array.isArray(list) && (list as any[]).some((s: any) => s?.id === sessionId)) {
        return ws as string
      }
    }
  } catch (e) {
    console.error(`[workspace-session] getWorkspaceIdForSessionId: error`, e)
  }
  return null
}

