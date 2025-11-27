import type { AgentTool } from '../../providers/provider'
import { redactOutput, sanitizeTerminalOutput } from '../utils'
import * as agentPty from '../../services/agentPty'
import { ServiceRegistry } from '../../services/base/ServiceRegistry.js'


export const sessionTailTool: AgentTool = {
  name: 'terminalSessionTail',
  description: 'Return the last part of the live buffer (small tail only) to inspect recent output without flooding tokens.',
  parameters: {
    type: 'object',
    properties: { maxBytes: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 } },
    additionalProperties: false,
  },
  run: async (args: { maxBytes?: number }, meta?: { requestId?: string; workspaceId?: string }) => {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const sessionService = ServiceRegistry.get<any>('session')
    const ws = meta?.workspaceId || workspaceService?.getWorkspaceRoot() || null
    const sessionId = (ws && sessionService) ? sessionService.getCurrentIdFor({ workspaceId: ws }) : null
    if (!sessionId) {
      console.error('[terminal.session_tail] No active sessionId')
      return { ok: false, error: 'no-session' }
    }

    const rec = agentPty.getSessionRecord(sessionId)
    if (!rec) {
      console.error('[terminal.session_tail] No session record found for sessionId:', sessionId)
      return { ok: false, error: 'no-session' }
    }

    const n = Math.max(100, Math.min(10000, args.maxBytes || 2000))
    const tailRaw = rec.state.ring.slice(-n)
    const tailSanitized = sanitizeTerminalOutput(tailRaw)
    const { redacted } = redactOutput(tailSanitized)
    console.log('[terminal.session_tail] Returning tail:', { sessionId, tailLength: redacted.length })
    return { ok: true, sessionId, tail: redacted }
  }
}

