import type { AgentTool } from '../../providers/provider'
import path from 'node:path'

export const sessionRestartTool: AgentTool = {
  name: 'terminal.session_restart',
  description: 'Restart the presented terminal session (kills and recreates).',
  parameters: { type: 'object', properties: { shell: { type: 'string' }, cwd: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' } }, additionalProperties: false },
  run: async (args: { shell?: string; cwd?: string; cols?: number; rows?: number }, meta?: { requestId?: string }) => {
    const req = meta?.requestId || 'terminal'
    const old = (globalThis as any).__agentPtyAssignments.get(req)
    if (old) {
      try { (globalThis as any).__agentPtySessions.get(old)?.p.kill() } catch {}
      (globalThis as any).__agentPtySessions.delete(old)
    }
    const root = path.resolve(process.env.APP_ROOT || process.cwd())
    const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined
    const tmpSid = await (globalThis as any).__createAgentPtySession({ shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows }) as string
    ;(globalThis as any).__agentPtyAssignments.set(req, tmpSid)
    return { ok: true, sessionId: tmpSid }
  }
}

