import type { AgentSessionState } from '../agent/types'
import { createSessionState } from '../agent/types'

const agentSessions = new Map<string, AgentSessionState>()

export function getOrCreateSession(requestId: string): AgentSessionState {
  let session = agentSessions.get(requestId)
  if (!session) {
    session = createSessionState(requestId)
    agentSessions.set(requestId, session)
  }
  session.lastActivity = Date.now()
  return session
}

export function initAgentSessionsCleanup() {
  // Clean up old sessions (older than 1 hour), run every 10 minutes
  setInterval(() => {
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    for (const [id, session] of agentSessions.entries()) {
      if (now - session.lastActivity > oneHour) {
        agentSessions.delete(id)
      }
    }
  }, 10 * 60 * 1000)
}

