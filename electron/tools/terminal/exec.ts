import type { AgentTool } from '../../providers/provider'
import { getWebContents } from '../../core/state'
import { logEvent, isRiskyCommand } from '../utils'
import { useMainStore } from '../../store/index'
import path from 'node:path'

export const terminalExecTool: AgentTool = {
  name: 'terminal.exec',
  description: 'Execute a command in the persistent terminal session (visible in UI). Auto-creates session if needed. Output streams to the visible terminal panel. Risk gating applies to destructive operations.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory (workspace-relative or absolute). Only used when creating a new session.' },
      autoApproveEnabled: { type: 'boolean' },
      autoApproveThreshold: { type: 'number' },
      confidence: { type: 'number' }
    },
    required: ['command'],
    additionalProperties: false,
  },
  run: async (
    args: { command: string; cwd?: string; autoApproveEnabled?: boolean; autoApproveThreshold?: number; confidence?: number },
    meta?: { requestId?: string }
  ) => {
    const req = meta?.requestId
    if (!req) {
      console.error('[terminal.exec] No requestId provided in meta')
      return { ok: false, error: 'no-request-id' }
    }
    console.log('[terminal.exec] Called with:', { command: args.command, requestId: req, meta })

    // Get or create session with optional cwd
    const root = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
    const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined
    console.log('[terminal.exec] Getting or creating PTY session:', { requestId: req, desiredCwd })

    const sid = await (globalThis as any).__getOrCreateAgentPtyFor(req, desiredCwd ? { cwd: desiredCwd } : undefined)
    console.log('[terminal.exec] Got session ID:', sid)

    const rec = (globalThis as any).__agentPtySessions.get(sid)
    if (!rec) {
      console.error('[terminal.exec] No session record found for sessionId:', sid)
      return { ok: false, error: 'no-session' }
    }
    console.log('[terminal.exec] Got session record:', { sessionId: sid, shell: rec.shell, cwd: rec.cwd })

    // Ensure the calling window is attached so output streams to the visible terminal
    try {
      const wc = getWebContents()
      if (wc) rec.attachedWcIds.add(wc.id)
    } catch {}

    // Risk gating
    const { risky, reason } = isRiskyCommand(args.command)
    await logEvent(sid, 'agent_pty_command_attempt', { command: args.command, risky, reason })
    if (risky) {
      const autoEnabled = !!args.autoApproveEnabled
      const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1
      const conf = typeof args.confidence === 'number' ? args.confidence : -1
      if (!(autoEnabled && conf >= threshold)) {
        await logEvent(sid, 'agent_pty_command_blocked', { command: args.command, reason, confidence: conf, threshold })
        return { ok: false, blocked: true, reason }
      }
    }

    // Execute command
    console.log('[terminal.exec] Executing command:', args.command)
    await (globalThis as any).__beginAgentCommand(rec.state, args.command)
    try {
      rec.p.write(args.command + (process.platform === 'win32' ? '\r\n' : '\n'))
      console.log('[terminal.exec] Command written to PTY')

      // Return session info along with execution confirmation
      const state = rec.state
      const lastCmds = state.commands.slice(-5).map((c: any) => ({
        id: c.id,
        command: c.command.slice(0, 200),
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        bytes: c.bytes,
        tail: c.data.slice(-200)
      }))

      const result = {
        ok: true,
        sessionId: sid,
        shell: rec.shell,
        cwd: rec.cwd,
        commandCount: state.commands.length,
        lastCommands: lastCmds,
        liveTail: state.ring.slice(-400)
      }
      console.log('[terminal.exec] Returning result:', { ok: result.ok, sessionId: result.sessionId, commandCount: result.commandCount })
      return result
    } catch (e: any) {
      console.error('[terminal.exec] Error executing command:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

