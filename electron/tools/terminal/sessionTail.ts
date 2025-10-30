import type { AgentTool } from '../../providers/provider'
import { redactOutput } from '../utils'

export const sessionTailTool: AgentTool = {
  name: 'terminalSessionTail',
  description: 'Return the last part of the live buffer (small tail only) to inspect recent output without flooding tokens.',
  parameters: {
    type: 'object',
    properties: { maxBytes: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 } },
    additionalProperties: false,
  },
  run: async (args: { maxBytes?: number }, meta?: { requestId?: string }) => {
    const req = meta?.requestId
    if (!req) {
      console.error('[terminal.session_tail] No requestId provided in meta')
      return { ok: false, error: 'no-request-id' }
    }
    console.log('[terminal.session_tail] Called with:', { requestId: req, maxBytes: args.maxBytes, meta })

    const sid = (globalThis as any).__agentPtyAssignments.get(req)
    console.log('[terminal.session_tail] Session ID from assignment:', sid)

    const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
    if (!sid || !rec) {
      console.error('[terminal.session_tail] No session found:', { requestId: req, sessionId: sid, hasRecord: !!rec })
      return { ok: false, error: 'no-session' }
    }

    const n = Math.max(100, Math.min(10000, args.maxBytes || 2000))
    const tail = rec.state.ring.slice(-n)
    const { redacted } = redactOutput(tail)
    console.log('[terminal.session_tail] Returning tail:', { sessionId: sid, tailLength: redacted.length })
    return { ok: true, sessionId: sid, tail: redacted }
  }
}

