import type { AgentTool } from '../../providers/provider'
import { useMainStore } from '../../store/index'
import path from 'node:path'
import * as agentPty from '../../services/agentPty'


export const sessionRestartTool: AgentTool = {
  name: 'terminalSessionRestart',
  description: 'Restart the presented terminal session (kills and recreates).',
  parameters: { type: 'object', properties: { shell: { type: 'string' }, cwd: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' } }, additionalProperties: false },
  run: async (args: { shell?: string; cwd?: string; cols?: number; rows?: number }, _meta?: { requestId?: string }) => {
    const stAny: any = useMainStore.getState()
    const ws = stAny.workspaceRoot || null
    const sessionId = (ws && typeof stAny.getCurrentIdFor === 'function') ? stAny.getCurrentIdFor({ workspaceId: ws }) : null
    if (!sessionId) {
      console.error('[terminal.session_restart] No active sessionId')
      return { ok: false, error: 'no-session' }
    }

    const root = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
    const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined

    try {
      // Dispose existing PTY (if any), then recreate with same sessionId
      try { agentPty.dispose(sessionId) } catch {}
      await agentPty.createAgentPtySession({ sessionId, shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows })
      console.log('[terminal.session_restart] Restarted PTY for session:', sessionId)
      return { ok: true, sessionId }
    } catch (e: any) {
      console.error('[terminal.session_restart] Failed to restart PTY:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

