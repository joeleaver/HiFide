/**
 * Shared utilities for agent tools
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import * as logging from '../utils/logging'
import * as edits from '../ipc/edits'
import { useMainStore } from '../store/index'

/**
 * Resolve a path within the workspace, preventing directory traversal
 */
export function resolveWithinWorkspace(p: string): string {
  const envRoot = process.env.HIFIDE_WORKSPACE_ROOT
  const storeRoot = useMainStore.getState().workspaceRoot
  const root = path.resolve(envRoot || storeRoot || process.cwd())
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) throw new Error('Path outside workspace')
  return norm
}

/**
 * Resolve a path within a provided workspace root, preventing directory traversal
 */
export function resolveWithinWorkspaceWithRoot(rootInput: string, p: string): string {
  const root = path.resolve(rootInput)
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) throw new Error('Path outside workspace')
  return norm
}

/**
 * Atomic file write
 */
export async function atomicWrite(filePath: string, content: string) {
  // Simple atomic write; can be enhanced with tmp file + rename
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Log an event to the session log
 */
export async function logEvent(sessionId: string, type: string, payload: any) {
  try {
    await logging.logEvent(sessionId, type, payload)
  } catch {}
}

/**
 * Check if a command is risky (installs, deletes, etc.)
 */
export function isRiskyCommand(cmd: string): { risky: boolean; reason?: string } {
  try {
    // Use existing security utility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sec = require('../utils/security')
    return sec.isRiskyCommand(cmd)
  } catch {
    // Conservative fallback
    const c = (cmd || '').trim()
    if (/\b(pnpm|npm|yarn)\s+install\b/i.test(c)) return { risky: true, reason: 'package install' }
    if (/\b(pnpm|npm|yarn)\s+add\b/i.test(c)) return { risky: true, reason: 'package add' }
    if (/\brm\s+-rf\b/i.test(c)) return { risky: true, reason: 'recursive delete' }
    if (/\bgit\s+(push|force|reset)\b/i.test(c)) return { risky: true, reason: 'git dangerous op' }
    return { risky: false }
  }
}

/**
 * Redact sensitive information from output
 */
export function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sec = require('../utils/security')
    return sec.redactOutput(input)
  } catch {
    let redacted = input || ''
    const patterns: RegExp[] = [/(?:sk|rk|pk|ak)-[A-Za-z0-9]{16,}/g, /Bearer\s+[A-Za-z0-9\-_.=]+/gi]
    const beforeLen = redacted.length
    for (const re of patterns) redacted = redacted.replace(re, '[REDACTED]')
    return { redacted, bytesRedacted: Math.max(0, beforeLen - redacted.length) }
  }
}
/**
 * Sanitize terminal output for LLM consumption by stripping ANSI/VT escape sequences
 * and non-printable control chars while preserving newlines and tabs. Also normalizes EOLs to \n.
 */
export function sanitizeTerminalOutput(input: string, opts?: { normalizeEol?: boolean }): string {
  if (!input) return ''
  const normalize = opts?.normalizeEol !== false
  let s = String(input)
  if (normalize) s = s.replace(/\r\n?|\n/g, '\n')
  // Strip OSC: ESC ] ... (BEL | ST)
  s = s.replace(/\u001B\][0-?]*[\s\S]*?(?:\u0007|\u001B\\)/g, '')
  // Strip DCS: ESC P ... (BEL | ST)
  s = s.replace(/\u001BP[\s\S]*?(?:\u0007|\u001B\\)/g, '')
  // Strip SOS/PM/APC: ESC X | ESC ^ | ESC _ ... (BEL | ST)
  s = s.replace(/\u001B[\x58\x5E\x5F][\s\S]*?(?:\u0007|\u001B\\)/g, '')
  // Strip CSI sequences: ESC [ ... final byte @-~
  s = s.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, '')
  // Strip single-char ESC sequences (save/restore cursor, reset, keypad modes, etc.)
  s = s.replace(/\u001B[@-Z\\^_]/g, '')
  // Remove remaining C0 controls except TAB (\t) and LF (\n)
  s = s.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
  return s
}


/**
 * Apply file edits using the edits module
 */
export async function applyFileEditsInternal(editsArray: any[] = [], opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}) {
  return (edits as any).applyFileEditsInternal(editsArray, opts)
}

/**
 * Apply sequential, single-file line range edits via edits module
 */
export async function applyLineRangeEditsInternal(pathRel: string, ranges: Array<{ startLine: number; endLine: number; newText: string }>, opts: { dryRun?: boolean } = {}) {
  return (edits as any).applyLineRangeEditsInternal(pathRel, ranges, opts)
}


