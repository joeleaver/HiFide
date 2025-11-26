import type { AgentTool } from '../../providers/provider'
import { sanitizeTerminalOutput, redactOutput } from '../utils'
import { useMainStore } from '../../store/index'
import * as agentPty from '../../services/agentPty'


export const sessionSearchOutputTool: AgentTool = {
  name: 'terminalSessionSearchOutput',
  description: 'Search the session\'s captured command outputs and/or live buffer for a substring; returns compact snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      caseSensitive: { type: 'boolean' },
      in: { type: 'string', enum: ['commands','live','all'], default: 'all' },
      maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 }
    },
    required: ['query'],
    additionalProperties: false,
  },
  run: async (
    args: { query: string; caseSensitive?: boolean; in?: 'commands'|'live'|'all'; maxResults?: number },
    meta?: { requestId?: string; workspaceId?: string }
  ) => {
    const stAny: any = useMainStore.getState()
    const ws = meta?.workspaceId || stAny.workspaceRoot || null
    const sessionId = (ws && typeof stAny.getCurrentIdFor === 'function') ? stAny.getCurrentIdFor({ workspaceId: ws }) : null
    if (!sessionId) {
      console.error('[terminal.session_search_output] No active sessionId')
      return { ok: false, error: 'no-session' }
    }

    const rec = agentPty.getSessionRecord(sessionId)
    if (!rec) {
      console.error('[terminal.session_search_output] No session found:', { sessionId })
      return { ok: false, error: 'no-session' }
    }
    const st = rec.state
    const q = args.caseSensitive ? args.query : args.query.toLowerCase()
    const max = Math.min(200, Math.max(1, args.maxResults || 30))
    const where = args.in || 'all'
    const results: any[] = []
    function findIn(text: string, source: any) {
      const hay = args.caseSensitive ? text : text.toLowerCase()
      let idx = 0
      while (results.length < max) {
        const pos = hay.indexOf(q, idx)
        if (pos === -1) break
        const start = Math.max(0, pos - 80)
        const end = Math.min(text.length, pos + q.length + 80)
        const snippetRaw = text.slice(start, end)
        const snippetSan = sanitizeTerminalOutput(snippetRaw)
        const snippet = redactOutput(snippetSan).redacted
        results.push({ ...source, pos, snippet })
        idx = pos + q.length
      }
    }
    if (where === 'all' || where === 'commands') {
      for (let i = st.commands.length - 1; i >= 0 && results.length < max; i--) {
        const c = st.commands[i]
        findIn(c.data, { type: 'command', id: c.id, command: c.command.slice(0, 200), startedAt: c.startedAt, endedAt: c.endedAt })
      }
    }
    if (where === 'all' || where === 'live') {
      findIn(st.ring, { type: 'live' })
    }
    console.log('[terminal.session_search_output] Returning results:', { sessionId, hitCount: results.length })
    return { ok: true, sessionId, hits: results }
  }
}

