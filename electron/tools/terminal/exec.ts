import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import { sanitizeTerminalOutput, redactOutput } from '../utils'
import * as agentPty from '../../services/agentPty'
import { ServiceRegistry } from '../../services/base/ServiceRegistry.js'

export const terminalExecTool: AgentTool = {
  name: 'terminalExec',
  description: 'Execute a command in the persistent terminal session (visible in UI). Auto-creates session if needed. Output streams to the visible terminal panel, and captured output is returned to the LLM (complete if quick; partial if long-running).',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory (workspace-relative or absolute). Only used when creating a new session.' },
      timeoutMs: { type: 'integer', minimum: 500, maximum: 30000, default: 5000, description: 'Max time to wait for output capture before returning partial output' },
      idleMs: { type: 'integer', minimum: 150, maximum: 2000, default: 300, description: 'Idle window (no new bytes) to consider command output quiescent' },
      tailBytes: { type: 'integer', minimum: 500, maximum: 20000, default: 6000, description: 'Max bytes of output to include in tool result (tail of buffer)' }
    },
    required: ['command'],
    additionalProperties: false,
  },
  run: async (
    args: { command: string; cwd?: string; timeoutMs?: number; idleMs?: number; tailBytes?: number },
    meta?: { requestId?: string; [key: string]: any }
  ) => {
    // Always use the current session ID for the agent PTY (one terminal per session)
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const sessionService = ServiceRegistry.get<any>('session')
    const ws = (meta as any)?.workspaceId || workspaceService?.getWorkspaceRoot() || null
    const sessionId = (ws && sessionService) ? sessionService.getCurrentIdFor({ workspaceId: ws }) : null
    if (!sessionId) {
      console.error('[terminal.exec] No active sessionId')
      return { ok: false, error: 'no-session' }
    }
    const req = meta?.requestId
    console.log('[terminal.exec] Called with:', { command: args.command, requestId: req, sessionId })

    // Get or create session with optional cwd
    const root = path.resolve((meta as any)?.workspaceId || workspaceService?.getWorkspaceRoot() || process.cwd())
    const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined
    console.log('[terminal.exec] Getting or creating PTY session:', { sessionId, desiredCwd })

    const sid = await agentPty.getOrCreateAgentPtyFor(sessionId, desiredCwd ? { cwd: desiredCwd } : undefined)
    console.log('[terminal.exec] Got session ID:', sid)

    const rec = agentPty.getSessionRecord(sid)
    if (!rec) {
      console.error('[terminal.exec] No session record found for sessionId:', sid)
      return { ok: false, error: 'no-session' }
    }
    console.log('[terminal.exec] Got session record:', { sessionId: sid, shell: rec.shell, cwd: rec.cwd })

    // Execute command
    console.log('[terminal.exec] Executing command:', args.command)
    await agentPty.beginCommand(rec.state, args.command)
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
      agentPty.write(sid, payload)
      console.log('[terminal.exec] Command written to PTY')

      // Heuristic: if PSReadLine falls into continuation prompt (" >> ")
      // after our write (seen sometimes on Windows), send Ctrl+C to recover.
      if (isWin) {
        try {
          await new Promise((r) => setTimeout(r, 60))
          const tail = String(rec.state.ring).slice(-200)
          if (/\n>> $/.test(tail) && !/\nPS [^\n]*> $/.test(tail)) {
            console.log('[terminal.exec] Detected continuation prompt, sending Ctrl+C to recover')
            agentPty.write(sid, '\x03') // Ctrl+C
          }
        } catch {}
      }

      // Passive capture: wait briefly for output and return either complete or partial text
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
      const timeoutMs = clamp(Number(args.timeoutMs ?? 5000), 500, 30000)
      const idleMs = clamp(Number(args.idleMs ?? 300), 150, 2000)
      const tailBytes = clamp(Number(args.tailBytes ?? 6000), 500, 20000)

      const idx = rec.state.activeIndex
      const capStart = Date.now()
      let lastBytes = (idx != null && rec.state.commands[idx]) ? rec.state.commands[idx].bytes : 0
      let lastChange = Date.now()

      // Poll for activity until idle or timeout
      while (Date.now() - capStart < timeoutMs) {
        await new Promise((r) => setTimeout(r, 80))
        const now = Date.now()
        const bytes = (idx != null && rec.state.commands[idx]) ? rec.state.commands[idx].bytes : lastBytes
        if (bytes !== lastBytes) {
          lastBytes = bytes
          lastChange = now
        } else if (now - lastChange > idleMs) {
          // Consider it quiescent
          break
        }
      }

      const raw = (idx != null && rec.state.commands[idx]) ? rec.state.commands[idx].data : String(rec.state.ring)
      const textRaw = raw.slice(-tailBytes)
      const textSanitized = sanitizeTerminalOutput(textRaw)
      const text = redactOutput(textSanitized).redacted
      const truncated = textRaw.length < raw.length
      const durationMs = Date.now() - capStart
      const complete = Date.now() - lastChange > idleMs

      // Return session info along with execution confirmation and captured output
      const state = rec.state
      const lastCmds = state.commands.slice(-5).map((c: any) => {
        const cmd = redactOutput(sanitizeTerminalOutput(c.command.slice(0, 200))).redacted
        const tail = redactOutput(sanitizeTerminalOutput(c.data.slice(-200))).redacted
        return {
          id: c.id,
          command: cmd,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          bytes: c.bytes,
          tail
        }
      })

      const liveTailRaw = state.ring.slice(-400)
      const liveTail = redactOutput(sanitizeTerminalOutput(liveTailRaw)).redacted

      const result = {
        ok: true,
        sessionId: sid,
        shell: rec.shell,
        cwd: rec.cwd,
        commandCount: state.commands.length,
        lastCommands: lastCmds,
        liveTail,
        captured: { text, bytes: lastBytes, truncated, durationMs, complete }
      }
      console.log('[terminal.exec] Returning result:', { ok: result.ok, sessionId: result.sessionId, commandCount: result.commandCount, complete })
      return result
    } catch (e: any) {
      console.error('[terminal.exec] Error executing command:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

