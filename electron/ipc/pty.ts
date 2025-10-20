/**
 * PTY (Pseudo-Terminal) session management IPC handlers
 * 
 * Handles both regular PTY sessions and agent-managed PTY sessions
 */

import type { IpcMain } from 'electron'
import { BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { getWindow } from '../core/state'
import { redactOutput, isRiskyCommand } from '../utils/security'
import { logEvent } from '../utils/logging'

const require = createRequire(import.meta.url)

/**
 * Minimal PTY interface
 */
type IPty = {
  onData: (cb: (data: string) => void) => void
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  kill: () => void
  pid: number
  onExit: (cb: (ev: { exitCode: number }) => void) => void
}

/**
 * Agent terminal state for ring buffer and command tracking
 */
type AgentTerminalState = {
  ring: string
  ringLimit: number
  commands: Array<{ id: number; command: string; startedAt: number; endedAt?: number; bytes: number; data: string }>
  maxCommands: number
  activeIndex: number | null
}

/**
 * Regular PTY sessions (UI-attached)
 */
const ptySessions = new Map<string, { p: IPty; wcId: number; log?: boolean }>()

/**
 * Agent-managed PTY sessions (ring buffer + command tracking)
 */
const agentPtySessions = new Map<string, {
  p: IPty
  shell: string
  cwd: string
  cols: number
  rows: number
  state: AgentTerminalState
  attachedWcIds: Set<number>
}>()

/**
 * Agent PTY assignments (requestId -> sessionId)
 */
const agentPtyAssignments = new Map<string, string>()

/**
 * Trim ring buffer to limit
 */
function trimRing(s: string, limit: number): string {
  if (s.length <= limit) return s
  return s.slice(s.length - limit)
}

/**
 * Push data to agent terminal state
 */
function pushDataToState(st: AgentTerminalState, chunk: string): void {
  const { redacted } = redactOutput(chunk)
  st.ring = trimRing(st.ring + redacted, st.ringLimit)
  if (st.activeIndex != null) {
    const rec = st.commands[st.activeIndex]
    if (rec) {
      rec.data = trimRing(rec.data + redacted, Math.min(st.ringLimit, 500_000))
      rec.bytes += Buffer.byteLength(redacted, 'utf8')
    }
  }
}

/**
 * Begin a new command in agent terminal
 */
async function beginCommand(st: AgentTerminalState, cmd: string): Promise<void> {
  // finalize previous
  if (st.activeIndex != null && st.commands[st.activeIndex]) {
    st.commands[st.activeIndex].endedAt = Date.now()
  }
  // cull old
  if (st.commands.length >= st.maxCommands) st.commands.shift()
  const rec = { id: (st.commands.at(-1)?.id ?? 0) + 1, command: cmd, startedAt: Date.now(), bytes: 0, data: '' }
  st.commands.push(rec)
  st.activeIndex = st.commands.length - 1
}

/**
 * Create an agent-managed PTY session
 */
async function createAgentPtySession(opts: { shell?: string; cwd?: string; cols?: number; rows?: number; sessionId?: string }): Promise<string> {
  const isWin = process.platform === 'win32'

  // Normalize requested shell: on Windows, force PowerShell if a POSIX shell was requested
  const normalizeShell = (s?: string) => {
    if (!s || !s.trim()) return s
    const lower = s.toLowerCase()
    if (isWin && (lower.includes('bash') || lower.includes('sh') || lower.includes('/bin/'))) {
      return 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    }
    return s
  }

  let shell = normalizeShell(opts.shell) || (isWin ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash'))
  const cols = opts.cols || 80
  const rows = opts.rows || 24
  const cwd = opts.cwd || process.cwd()

  // Try spawn with requested/normalized shell, then fallback to platform default on failure
  const ptyModule = require('@homebridge/node-pty-prebuilt-multiarch')
  let p: IPty
  try {
    p = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env: process.env })
  } catch (e) {
    // Fallback once to a safe default shell
    shell = (isWin ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash'))
    p = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env: process.env })
  }

  const sessionId = opts.sessionId || randomUUID()
  const state: AgentTerminalState = { ring: '', ringLimit: 1_000_000, commands: [], maxCommands: 50, activeIndex: null }
  agentPtySessions.set(sessionId, { p, shell, cwd, cols, rows, state, attachedWcIds: new Set<number>() })
  await logEvent(sessionId, 'agent_pty_create', { shell, cwd, cols, rows })
  
  p.onData(async (data: string) => {
    try {
      const { redacted, bytesRedacted } = redactOutput(data)
      if (bytesRedacted > 0) {
        await logEvent(sessionId, 'data_redacted', { bytesRedacted })
      }
      // Update in-memory buffers
      pushDataToState(state, redacted)
      // Fanout to any attached renderer terminals
      const rec = agentPtySessions.get(sessionId)
      const ids = rec?.attachedWcIds
      if (ids && ids.size > 0) {
        for (const id of ids) {
          try {
            const wc = BrowserWindow.fromId(id)?.webContents
            if (wc) wc.send('pty:data', { sessionId, data: redacted })
          } catch {}
        }
      }
    } catch {}
  })
  
  p.onExit(async ({ exitCode }: { exitCode: number }) => {
    await logEvent(sessionId, 'agent_pty_exit', { exitCode })
    // Notify any attached renderers
    const rec = agentPtySessions.get(sessionId)
    const ids = rec?.attachedWcIds
    if (ids && ids.size > 0) {
      for (const id of ids) {
        try {
          BrowserWindow.fromId(id)?.webContents?.send('pty:exit', { sessionId, exitCode })
        } catch {}
      }
    }
    agentPtySessions.delete(sessionId)
    // detach assignment if any
    for (const [req, sid] of agentPtyAssignments.entries()) {
      if (sid === sessionId) agentPtyAssignments.delete(req)
    }
  })

  return sessionId
}

/**
 * Get or create agent PTY for a request ID
 * The PTY session ID will be the same as the request ID for easy tracking
 */
async function getOrCreateAgentPtyFor(requestId: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<string> {
  let sid = agentPtyAssignments.get(requestId)
  if (sid && agentPtySessions.has(sid)) return sid

  // Use the requestId as the session ID so they're the same
  sid = await createAgentPtySession({ ...opts, sessionId: requestId })
  agentPtyAssignments.set(requestId, sid)
  return sid
}

// Expose agent PTY helpers for use in tool handlers (via globalThis)
;(globalThis as any).__agentPtySessions = agentPtySessions
;(globalThis as any).__agentPtyAssignments = agentPtyAssignments
;(globalThis as any).__createAgentPtySession = createAgentPtySession
;(globalThis as any).__getOrCreateAgentPtyFor = getOrCreateAgentPtyFor
;(globalThis as any).__beginAgentCommand = beginCommand

/**
 * Register PTY IPC handlers
 */
export function registerPtyHandlers(ipcMain: IpcMain): void {
  /**
   * Create a new PTY session
   */
  ipcMain.handle('pty:create', async (event, opts: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean } = {}) => {
    const wc = event.sender
    const isWin = process.platform === 'win32'

    const shell = opts.shell || (isWin ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash'))
    const cols = opts.cols || 80
    const rows = opts.rows || 24
    const env = { ...process.env, ...(opts.env || {}) }
    const cwd = opts.cwd || process.cwd()
    
    try {
      const ptyModule = require('@homebridge/node-pty-prebuilt-multiarch')
      const p = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env })
      const sessionId = randomUUID()
      ptySessions.set(sessionId, { p, wcId: wc.id, log: opts.log !== false })
      await logEvent(sessionId, 'session_create', { shell, cwd, cols, rows })
      
      p.onData(async (data: string) => {
        try {
          const { redacted, bytesRedacted } = redactOutput(data)
          if (bytesRedacted > 0) {
            await logEvent(sessionId, 'data_redacted', { bytesRedacted })
          }
          wc.send('pty:data', { sessionId, data: redacted })
        } catch {}
      })
      
      p.onExit(async ({ exitCode }: { exitCode: number }) => {
        try {
          wc.send('pty:exit', { sessionId, exitCode })
        } catch {}
        await logEvent(sessionId, 'session_exit', { exitCode })
        ptySessions.delete(sessionId)
      })
      
      return { sessionId }
    } catch (e: any) {
      throw e
    }
  })

  /**
   * Execute agent-initiated command with policy gating
   */
  ipcMain.handle('pty:exec-agent', async (_event, args: { sessionId: string; command: string; confidence?: number; autoApproveEnabled?: boolean; autoApproveThreshold?: number }) => {
    const s = ptySessions.get(args.sessionId)
    if (!s) return { ok: false, error: 'no-session' }
    
    const { risky, reason } = isRiskyCommand(args.command)
    await logEvent(args.sessionId, 'command_attempt', { command: args.command, risky, reason })
    
    if (risky) {
      const autoEnabled = !!args.autoApproveEnabled
      const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1 // impossible
      const conf = typeof args.confidence === 'number' ? args.confidence : -1
      const shouldAutoApprove = autoEnabled && conf >= threshold

      if (shouldAutoApprove) {
        await logEvent(args.sessionId, 'command_decision', { command: args.command, allowed: true, decision_reason: 'auto_approved', confidence: conf, threshold })
      } else {
        let allowed = false
        try {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            const r = await dialog.showMessageBox(win, {
              type: 'warning',
              buttons: ['Allow', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              title: 'Confirm risky command',
              message: `This command may be risky (${reason}).`,
              detail: args.command,
              noLink: true,
            })
            allowed = r.response === 0
          }
        } catch {
          allowed = false
        }
        await logEvent(args.sessionId, 'command_decision', { command: args.command, allowed, decision_reason: 'manual', confidence: conf, threshold })
        if (!allowed) return { ok: false, blocked: true }
      }
    }
    
    // Write command followed by newline
    s.p.write(args.command + (process.platform === 'win32' ? '\r\n' : '\n'))
    return { ok: true }
  })

  /**
   * Write data to PTY
   */
  ipcMain.handle('pty:write', async (_event, args: { sessionId: string; data: string }) => {
    const s = ptySessions.get(args.sessionId)
    if (!s) {
      return { ok: false }
    }
    try {
      s.p.write(args.data)
      return { ok: true }
    } catch (e) {
      console.error('[pty:write] error', e)
      return { ok: false, error: (e as any)?.message || String(e) }
    }
  })

  /**
   * Resize PTY
   */
  ipcMain.handle('pty:resize', async (_event, args: { sessionId: string; cols: number; rows: number }) => {
    const s = ptySessions.get(args.sessionId)
    if (s) s.p.resize(args.cols, args.rows)
    return { ok: !!s }
  })

  /**
   * Dispose PTY session
   */
  ipcMain.handle('pty:dispose', async (_event, args: { sessionId: string }) => {
    const s = ptySessions.get(args.sessionId)
    if (s) {
      try {
        s.p.kill()
      } catch {}
      ptySessions.delete(args.sessionId)
    }
    return { ok: true }
  })

  /**
   * Attach renderer to agent PTY session
   */
  ipcMain.handle('agent-pty:attach', async (event, args: { requestId?: string; sessionId?: string; tailBytes?: number } = {}) => {
    const wc = event.sender
    console.log('[agent-pty:attach] Called with:', args, 'wcId:', wc.id)
    let sid = args.sessionId
    if (!sid) {
      const req = args.requestId
      if (!req) {
        console.error('[agent-pty:attach] No requestId or sessionId provided')
        return { ok: false, error: 'no-request-id' }
      }

      // Get workspace root for cwd
      const { useMainStore } = await import('../store/index.js')
      const workspaceRoot = useMainStore.getState().workspaceRoot

      console.log('[agent-pty:attach] Getting or creating PTY for requestId:', req)
      sid = await getOrCreateAgentPtyFor(req, { cwd: workspaceRoot || undefined })
      console.log('[agent-pty:attach] Got sessionId:', sid)
    }
    const rec = sid ? agentPtySessions.get(sid) : undefined
    if (!sid || !rec) {
      console.error('[agent-pty:attach] No session found:', { sid, hasRec: !!rec })
      return { ok: false, error: 'no-session' }
    }

    console.log('[agent-pty:attach] Attaching wcId', wc.id, 'to session', sid)
    rec.attachedWcIds.add(wc.id)
    console.log('[agent-pty:attach] Attached wcIds:', Array.from(rec.attachedWcIds))

    // Optionally seed terminal with current tail (already redacted in state)
    const n = Math.max(0, Math.min(10000, args.tailBytes || 0))
    if (n > 0) {
      try {
        const tail = rec.state.ring.slice(-n)
        console.log('[agent-pty:attach] Sending tail:', tail.length, 'bytes')
        wc.send('pty:data', { sessionId: sid, data: tail })
      } catch {}
    }
    return { ok: true, sessionId: sid }
  })

  /**
   * Detach renderer from agent PTY session
   */
  ipcMain.handle('agent-pty:detach', async (event, args: { sessionId: string }) => {
    const wc = event.sender
    const rec = agentPtySessions.get(args.sessionId)
    if (!rec) return { ok: true }
    rec.attachedWcIds.delete(wc.id)
    return { ok: true }
  })

}

