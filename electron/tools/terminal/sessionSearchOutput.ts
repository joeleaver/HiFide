import type { AgentTool } from '../../providers/provider'

export const sessionSearchOutputTool: AgentTool = {
  name: 'terminal.session_search_output',
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
    meta?: { requestId?: string }
  ) => {
    const req = meta?.requestId || 'terminal'
    const sid = (globalThis as any).__agentPtyAssignments.get(req)
    const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
    if (!sid || !rec) return { ok: false, error: 'no-session' }
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
        const snippet = text.slice(start, end)
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
    return { ok: true, sessionId: sid, hits: results }
  }
}

