import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { redactOutput } from '../utils/security'
import { logEvent } from '../utils/logging'
import { broadcastWorkspaceNotification } from '../backend/ws/broadcast'
import { useMainStore } from '../store'

const require = createRequire(import.meta.url)

// Minimal PTY interface
export type IPty = {
  onData: (cb: (data: string) => void) => void
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  kill: () => void
  pid: number
  onExit: (cb: (ev: { exitCode: number }) => void) => void
}

function loadPtyModule(): any | null {
  try {
    const mod = require('node-pty')
    return mod
  } catch (e) {
    console.warn('[agentPty] Native PTY module not available')
    return null
  }
}

export type AgentTerminalState = {
  ring: string
  ringLimit: number
  commands: Array<{ id: number; command: string; startedAt: number; endedAt?: number; bytes: number; data: string }>
  maxCommands: number
  activeIndex: number | null
}

export type AgentPtyRecord = {
  p: IPty
  shell: string
  cwd: string
  cols: number
  rows: number
  state: AgentTerminalState
}

export const agentPtySessions = new Map<string, AgentPtyRecord>()

function trimRing(s: string, limit: number): string {
  if (s.length <= limit) return s
  return s.slice(s.length - limit)
}

export function pushDataToState(st: AgentTerminalState, chunk: string): void {
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

export async function beginCommand(st: AgentTerminalState, cmd: string): Promise<void> {
  if (st.activeIndex != null && st.commands[st.activeIndex]) {
    st.commands[st.activeIndex].endedAt = Date.now()
  }
  if (st.commands.length >= st.maxCommands) st.commands.shift()
  const last = st.commands.length > 0 ? st.commands[st.commands.length - 1] : undefined
  const rec = { id: ((last?.id) ?? 0) + 1, command: cmd, startedAt: Date.now(), bytes: 0, data: '' }
  st.commands.push(rec)
  st.activeIndex = st.commands.length - 1
}

function getDefaultCwd(): string {
  try {
    const st: any = useMainStore.getState()
    return st.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  } catch {
    return process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  }
}

function workspaceForSession(sessionId: string | undefined): string | null {
  if (!sessionId) return null
  try {
    const st: any = useMainStore.getState()
    const map = st.sessionsByWorkspace || {}
    for (const [ws, list] of Object.entries(map as Record<string, any[]>)) {
      if (Array.isArray(list) && (list as any[]).some((s: any) => s?.id === sessionId)) return ws as string
    }
  } catch {}
  return null
}


export async function createAgentPtySession(opts: { shell?: string; cwd?: string; cols?: number; rows?: number; sessionId?: string }): Promise<string> {
  const isWin = process.platform === 'win32'

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
  const wsForSession = opts.sessionId ? workspaceForSession(opts.sessionId) : null
  const cwd = opts.cwd || wsForSession || getDefaultCwd()

  const ptyModule = loadPtyModule()
  if (!ptyModule) throw new Error('pty-unavailable')

  // Use conservative args for agent PTY to avoid PSReadLine/continuation issues on Windows
  const shellArgs = (isWin && shell.toLowerCase().includes('powershell')) ? ['-NoLogo', '-NoProfile'] : []
  const p: IPty = (ptyModule as any).spawn(shell, shellArgs, { name: 'xterm-256color', cols, rows, cwd, env: process.env })

  const sessionId = opts.sessionId || randomUUID()
  const state: AgentTerminalState = { ring: '', ringLimit: 1_000_000, commands: [], maxCommands: 50, activeIndex: null }
  agentPtySessions.set(sessionId, { p, shell, cwd, cols, rows, state })
  await logEvent(sessionId, 'agent_pty_create', { shell, cwd, cols, rows })

  p.onData(async (data: string) => {
    try {
      const { redacted, bytesRedacted } = redactOutput(data)
      if (bytesRedacted > 0) {
        await logEvent(sessionId, 'data_redacted', { bytesRedacted })
      }
      pushDataToState(state, redacted)
      try {
        const wsId = workspaceForSession(sessionId) || ((useMainStore.getState() as any).workspaceRoot || null)
        if (wsId) broadcastWorkspaceNotification(wsId, 'terminal.data', { sessionId, data: redacted })
      } catch {}
    } catch {}
  })

  p.onExit(async ({ exitCode }: { exitCode: number }) => {
    await logEvent(sessionId, 'agent_pty_exit', { exitCode })
    try {
      const wsId = workspaceForSession(sessionId) || ((useMainStore.getState() as any).workspaceRoot || null)
      if (wsId) broadcastWorkspaceNotification(wsId, 'terminal.exit', { sessionId, exitCode })
    } catch {}
    agentPtySessions.delete(sessionId)
  })

  return sessionId
}

export async function getOrCreateAgentPtyFor(requestId: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<string> {
  let sid = requestId
  if (agentPtySessions.has(sid)) return sid
  sid = await createAgentPtySession({ ...opts, sessionId: requestId })
  return sid
}

export function getSessionRecord(sessionId: string): AgentPtyRecord | undefined {
  return agentPtySessions.get(sessionId)
}

export function write(sessionId: string, data: string): { ok: boolean } {
  const rec = agentPtySessions.get(sessionId)
  if (!rec) return { ok: false }
  try {
    rec.p.write(data)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function resize(sessionId: string, cols: number, rows: number): { ok: boolean } {
  const rec = agentPtySessions.get(sessionId)
  if (!rec) return { ok: false }
  try {
    rec.p.resize(cols, rows)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function dispose(sessionId: string): { ok: boolean } {
  const rec = agentPtySessions.get(sessionId)
  if (!rec) return { ok: true }
  try { rec.p.kill() } catch {}
  agentPtySessions.delete(sessionId)
  return { ok: true }
}

