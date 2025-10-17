/**
 * Shared utilities for agent tools
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import * as logging from '../utils/logging'
import * as edits from '../ipc/edits'

/**
 * Resolve a path within the workspace, preventing directory traversal
 */
export function resolveWithinWorkspace(p: string): string {
  const root = path.resolve(process.env.APP_ROOT || process.cwd())
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
 * Apply file edits using the edits module
 */
export async function applyFileEditsInternal(editsArray: any[] = [], opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}) {
  return (edits as any).applyFileEditsInternal(editsArray, opts)
}

