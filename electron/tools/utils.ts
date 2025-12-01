/**
 * Shared utilities for agent tools
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import * as logging from '../utils/logging'
import { resolveWithinWorkspace } from '../utils/workspace'
import { redactOutput, isRiskyCommand } from '../utils/security'

// Re-export for convenience
export { resolveWithinWorkspace, redactOutput, isRiskyCommand }

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





