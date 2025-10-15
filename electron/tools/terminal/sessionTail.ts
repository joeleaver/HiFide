import type { AgentTool } from '../../providers/provider'
import { redactOutput } from '../utils'

export const sessionTailTool: AgentTool = {
  name: 'terminal.session_tail',
  description: 'Return the last part of the live buffer (small tail only) to inspect recent output without flooding tokens.',
  parameters: {
    type: 'object',
    properties: { maxBytes: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 } },
    additionalProperties: false,
  },
  run: async (args: { maxBytes?: number }, meta?: { requestId?: string }) => {
    const req = meta?.requestId || 'terminal'
    const sid = (globalThis as any).__agentPtyAssignments.get(req)
    const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
    if (!sid || !rec) return { ok: false, error: 'no-session' }
    const n = Math.max(100, Math.min(10000, args.maxBytes || 2000))
    const tail = rec.state.ring.slice(-n)
    const { redacted } = redactOutput(tail)
    return { ok: true, sessionId: sid, tail: redacted }
  }
}

