import type { AgentTool } from '../../providers/provider'
import * as ptySpawn from '../../services/ptySpawn.js'



export const terminalExecTool: AgentTool = {
  name: 'terminalExec',
  description: 'Execute a shell command.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeoutMs: { type: 'integer' },
      cwd: { type: 'string' }
    },
    required: ['command'],
  },
  run: async (args: { command: string; timeoutMs?: number; cwd?: string }, meta?: Record<string, any> & { workspaceId?: string }) => {
    const MAX_LINES = 500
    const startMs = Date.now()
    const id = crypto.randomUUID()
    try {
      const cwd = args.cwd || meta?.workspaceId || process.cwd()
      const res = await ptySpawn.spawnPty(args.command, cwd, args.timeoutMs)
      const durationMs = Date.now() - startMs
      const timestamp = Date.now()

      let msg = ''
      if (res.timedOut) msg += '\\n⚠️ Timed out after 60s (killed). '
      if (res.fullLines > MAX_LINES) msg += `\\n📄 Preview of last ${res.lines} lines (total ${res.fullLines}). `
      if (res.exitCode !== 0 && res.exitCode !== null) msg += `\\n❌ Non-zero exit: ${res.exitCode}`

      const label = `$${args.command.slice(0, 40)}${args.command.length > 40 ? '...' : ''}`

      return {
        ok: true,
        output: res.output + msg,
        exitCode: res.exitCode,
        timedOut: res.timedOut,
        lines: res.lines,
        fullLines: res.fullLines,
        durationMs,
        badge: {
          id,
          type: 'tool' as const,
          timestamp,
          label,
          toolName: 'terminalExec',
          status: 'success' as const,
          expandable: true,
          contentType: 'terminal-exec' as const,
          metadata: {
            duration: durationMs,
            cwd,
            lines: res.lines,
            fullLines: res.fullLines,
            exitCode: res.exitCode ?? null,
            timedOut: res.timedOut,
            previewLines: 20,
          },
          args,
          result: { outputPreview: res.output.slice(0, 4000), fullOutputAvailable: res.fullLines > MAX_LINES },
        },
      }
    } catch (error: any) {
      console.error('[terminal.exec] Error:', error)
      const durationMs = Date.now() - startMs
      const timestamp = Date.now()
      return {
        ok: false,
        error: error?.message || String(error),
        durationMs,
        badge: {
          id: crypto.randomUUID(),
          type: 'tool' as const,
          timestamp,
          label: `terminalExec: error`,
          toolName: 'terminalExec',
          status: 'error' as const,
          expandable: true,
          contentType: 'terminal-exec' as const,
          metadata: { duration: durationMs, error: error?.message },
          error: error?.message || String(error),
          args,
        },
      }
    }
  },
}

export default terminalExecTool
