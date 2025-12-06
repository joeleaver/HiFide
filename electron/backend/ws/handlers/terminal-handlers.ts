/**
 * Terminal RPC handlers
 * 
 * Handles terminal creation, PTY operations, agent PTY, and terminal tab management
 */

import { randomUUID } from 'node:crypto'

import { getConnectionWorkspaceId } from '../broadcast.js'
import { createRequire } from 'node:module'
import { redactOutput } from '../../../utils/security'

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



  // Terminal tab management RPCs removed post-refactor (non-interactive terminalExec only)
}