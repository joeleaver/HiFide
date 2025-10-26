import type { AgentTool } from '../../providers/provider'
import { getWebContents } from '../../core/state'

import { useMainStore } from '../../store/index'
import path from 'node:path'

export const terminalExecTool: AgentTool = {
  name: 'terminal.exec',
  description: 'Execute a command in the persistent terminal session (visible in UI). Auto-creates session if needed. Output streams to the visible terminal panel.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory (workspace-relative or absolute). Only used when creating a new session.' },

    },
    required: ['command'],
    additionalProperties: false,
  },
  run: async (
    args: { command: string; cwd?: string },
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



    // Execute command
    console.log('[terminal.exec] Executing command:', args.command)
    await (globalThis as any).__beginAgentCommand(rec.state, args.command)
    try {
      // On Windows/PSReadLine, wrap the command in Bracketed Paste markers to
      // ensure the entire command is processed atomically and avoid falling into
      // continuation mode (" >> ") if quotes/braces briefly appear unmatched.
      const isWin = process.platform === 'win32'
      const EOL = isWin ? '\r\n' : '\n'
      const ENTER = isWin ? '\r' : '\n'
      const BP_START = '\x1b[200~'
      const BP_END = '\x1b[201~'

      // Normalize command line endings and strip trailing newlines to avoid
      // PSReadLine seeing partial lines or extra blank lines.
      const cmd = args.command
        .replace(/\r\n?|\n/g, EOL)
        .replace(/[\u2028\u2029]/g, EOL)
        .trimEnd()

      // Only use bracketed paste on Windows (PowerShell/PSReadLine supports it by default).
      // Other shells also support it, but we keep scope conservative to avoid echoing
      // the markers on exotic shells that might not have it enabled.
      const payload = isWin ? (BP_START + cmd + BP_END + ENTER) : (cmd + ENTER)
      rec.p.write(payload)
      console.log('[terminal.exec] Command written to PTY')

      // Heuristic: if PSReadLine falls into continuation prompt (" >> ")
      // after our write (seen sometimes on Windows), send Ctrl+C to recover.
      if (isWin) {
        try {
          await new Promise((r) => setTimeout(r, 60))
          const tail = String(rec.state.ring).slice(-200)
          if (/\n>> $/.test(tail) && !/\nPS [^\n]*> $/.test(tail)) {
            console.log('[terminal.exec] Detected continuation prompt, sending Ctrl+C to recover')
            rec.p.write('\x03') // Ctrl+C
          }
        } catch {}
      }

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

