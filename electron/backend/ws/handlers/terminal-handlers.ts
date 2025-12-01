/**
 * Terminal RPC handlers
 * 
 * Handles terminal creation, PTY operations, agent PTY, and terminal tab management
 */

import { randomUUID } from 'node:crypto'
import { getTerminalService } from '../../../services/index.js'
import { getConnectionWorkspaceId } from '../broadcast.js'
import { createRequire } from 'node:module'
import { redactOutput } from '../../../utils/security'
import * as agentPty from '../../../services/agentPty'
import type { RpcConnection } from '../types'

const require = createRequire(import.meta.url)

// Minimal PTY interface
type IPty = {
  onData: (cb: (data: string) => void) => void
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  kill: () => void
  pid: number
  onExit: (cb: (ev: { exitCode: number }) => void) => void
}

/**
 * Create terminal service with all terminal-related RPC handlers
 */
export function createTerminalHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  const ptySessions = new Map<string, { p: IPty }>()

  function loadPtyModule(): any | null {
    try {
      const mod = require('node-pty')
      return mod
    } catch (e) {
      return null
    }
  }

  // Terminal PTY operations
  addMethod('terminal.create', async (opts: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean } = {}) => {
    const isWin = process.platform === 'win32'
    const shell = opts.shell || (isWin ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash'))
    const cols = opts.cols || 80
    const rows = opts.rows || 24
    const env = { ...process.env, ...(opts.env || {}) }

    const boundCwd = await getConnectionWorkspaceId(connection)
    if (!opts.cwd && !boundCwd) {
      throw new Error('No workspace bound to connection and no cwd provided')
    }
    const cwd = opts.cwd || boundCwd!

    const ptyModule = loadPtyModule()
    if (!ptyModule) throw new Error('pty-unavailable')

    const p: IPty = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env })
    const sessionId = randomUUID()
    ptySessions.set(sessionId, { p })

    p.onData((data: string) => {
      try {
        const { redacted } = redactOutput(data)
        connection.sendNotification('terminal.data', { sessionId, data: redacted })
      } catch { }
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      try { connection.sendNotification('terminal.exit', { sessionId, exitCode }) } catch { }
      ptySessions.delete(sessionId)
    })

    return { sessionId }
  })

  addMethod('terminal.write', async ({ sessionId, data }: { sessionId: string; data: string }) => {
    const s = ptySessions.get(sessionId)
    if (!s) return { ok: false }
    try { s.p.write(data); return { ok: true } } catch { return { ok: false } }
  })

  addMethod('terminal.resize', async ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    const s = ptySessions.get(sessionId)
    if (s) try { s.p.resize(cols, rows) } catch { }
    return { ok: !!s }
  })

  addMethod('terminal.dispose', async ({ sessionId }: { sessionId: string }) => {
    const s = ptySessions.get(sessionId)
    if (s) {
      try { s.p.kill() } catch { }
      ptySessions.delete(sessionId)
    }
    return { ok: true }
  })

  // Agent PTY service (via shared service module)
  addMethod('agent-pty.attach', async (args: { requestId?: string; sessionId?: string; tailBytes?: number } = {}) => {
    const sid = args.sessionId || args.requestId
    if (!sid) return { ok: false, error: 'no-session' }

    // Ensure exists (create if needed)
    try { await agentPty.getOrCreateAgentPtyFor(sid) } catch (e) { return { ok: false, error: 'pty-unavailable' } }
    const rec = agentPty.getSessionRecord(sid)
    if (!rec) return { ok: false, error: 'no-session' }

    // Optionally seed with tail to this connection only
    const n = Math.max(0, Math.min(10000, args.tailBytes || 0))
    if (n > 0 && rec.state.ring && rec.state.ring.length > 0) {
      try {
        const tail = rec.state.ring.slice(-n)
        connection.sendNotification('terminal.data', { sessionId: sid, data: tail })
      } catch { }
    }
    return { ok: true, sessionId: sid }
  })

  addMethod('agent-pty.resize', async ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    return agentPty.resize(sessionId, cols, rows)
  })

  addMethod('agent-pty.write', async ({ sessionId, data }: { sessionId: string; data: string }) => {
    return agentPty.write(sessionId, data)
  })

  addMethod('agent-pty.exec', async ({ sessionId, command }: { sessionId: string; command: string }) => {
    const rec = agentPty.getSessionRecord(sessionId)
    if (!rec) return { ok: false, error: 'no-session' }
    await agentPty.beginCommand(rec.state, command)
    const isWin = process.platform === 'win32'
    const EOL = isWin ? '\r\n' : '\n'
    const ENTER = isWin ? '\r' : '\n'
    const BP_START = '\x1b[200~'
    const BP_END = '\x1b[201~'
    const cmd = String(command).replace(/\r\n?|\n/g, EOL).replace(/[\u2028\u2029]/g, EOL).trimEnd()
    const payload = isWin ? (BP_START + cmd + BP_END + ENTER) : (cmd + ENTER)
    try { rec.p.write(payload); return { ok: true } } catch { return { ok: false } }
  })

  addMethod('agent-pty.detach', async (_args: { sessionId: string }) => {
    // No-op for now; session persists until killed
    return { ok: true }
  })

  // Terminal UI state: list of tabs and active terminals
  addMethod('terminal.getTabs', async () => {
    try {      const terminalService = getTerminalService()

      return {
        ok: true,
        agentTabs: terminalService?.getAgentTerminalTabs() || [],
        agentActive: terminalService?.getAgentActiveTerminal() || null,
        explorerTabs: terminalService?.getExplorerTerminalTabs() || [],
        explorerActive: terminalService?.getExplorerActiveTerminal() || null,
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Terminal tab management RPCs
  addMethod('terminal.addTab', async ({ context }: { context: 'agent' | 'explorer' }) => {
    try {      const terminalService = getTerminalService()
      const id = terminalService?.addTerminalTab(context) || null
      return { ok: true, tabId: id }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.removeTab', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
    try {      const terminalService = getTerminalService()
      terminalService?.removeTerminalTab({ context, tabId })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.setActive', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
    try {      const terminalService = getTerminalService()
      terminalService?.setActiveTerminal({ context, tabId })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.restartAgent', async ({ tabId }: { tabId: string }) => {
    try {      const terminalService = getTerminalService()
      // Dispose the PTY and let the UI remount it
      await terminalService.disposePty(tabId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}