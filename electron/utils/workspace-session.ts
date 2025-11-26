/**
 * Shared utility for resolving workspace from session ID
 * Used by both flows-v2 and WebSocket server
 */

import { useMainStore } from '../store/index'

/**
 * Find which workspace contains a given session ID
 * @param sessionId The session ID to look up
 * @returns The workspace ID (absolute path) or null if not found
 */
export function getWorkspaceIdForSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null
  try {
    const st: any = useMainStore.getState()
    const map = st.sessionsByWorkspace || {}
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

