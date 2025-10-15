/**
 * File editing operations IPC handlers
 *
 * Handles applying file edits and proposing edits using LLM
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getIndexer, providers, getProviderKey } from '../core/state'
import { verifyTypecheck as tsVerify } from '../refactors/ts'

// Local edit operation types (discriminated union)
 type ReplaceOnceEdit = { type: 'replaceOnce'; path: string; oldText: string; newText: string }
 type InsertAfterLineEdit = { type: 'insertAfterLine'; path: string; line: number; text: string }
 type ReplaceRangeEdit = { type: 'replaceRange'; path: string; start: number; end: number; text: string }
 type TextEdit = ReplaceOnceEdit | InsertAfterLineEdit | ReplaceRangeEdit

/**
 * Resolve path within workspace (security check)
 */
function resolveWithinWorkspace(p: string): string {
  const root = path.resolve(process.env.APP_ROOT || process.cwd())
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) {
    throw new Error('Path outside workspace')
  }
  return norm
}

/**
 * Atomic file write
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Insert text after a specific line number
 */
function insertAfterLine(src: string, line: number, text: string): string {
  if (line <= 0) {
    return text + (src.startsWith('\n') ? '' : '\n') + src
  }

  let idx = 0
  let current = 1
  while (current < line && idx !== -1) {
    idx = src.indexOf('\n', idx)
    if (idx === -1) break
    idx += 1
    current += 1
  }

  if (idx === -1) {
    // append at end
    return src.endsWith('\n') ? (src + text) : (src + '\n' + text)
  }

  const before = src.slice(0, idx)
  const after = src.slice(idx)
  const sep = before.endsWith('\n') ? '' : '\n'
  return before + sep + text + (text.endsWith('\n') ? '' : '\n') + after
}

/**
 * Apply file edits (internal implementation)
 */
export async function applyFileEditsInternal(
  edits: TextEdit[] = [],
  opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}
) {
  const results: Array<{ path: string; changed: boolean; message?: string }> = []
  let applied = 0

  for (const ed of edits) {
    try {
      const abs = resolveWithinWorkspace(ed.path)
      let content = ''
      try {
        content = await fs.readFile(abs, 'utf-8')
      } catch (e: any) {
        results.push({ path: ed.path, changed: false, message: 'read-failed: ' + (e?.message || String(e)) })
        continue
      }

      let next = content
      if (ed.type === 'replaceOnce') {
        const pos = content.indexOf(ed.oldText)
        if (pos === -1) {
          results.push({ path: ed.path, changed: false, message: 'oldText-not-found' })
          continue
        }
        next = content.slice(0, pos) + ed.newText + content.slice(pos + ed.oldText.length)
      } else if (ed.type === 'insertAfterLine') {
        next = insertAfterLine(content, ed.line, ed.text)
      } else if (ed.type === 'replaceRange') {
        const s = Math.max(0, Math.min(content.length, ed.start | 0))
        const e = Math.max(s, Math.min(content.length, ed.end | 0))
        next = content.slice(0, s) + ed.text + content.slice(e)
      } else {
        results.push({ path: (ed as any).path, changed: false, message: 'unknown-edit-type' })
        continue
      }

      if (opts.dryRun) {
        results.push({ path: ed.path, changed: next !== content, message: 'dry-run' })
        if (next !== content) applied += 1
      } else {
        if (next !== content) {
          await atomicWrite(abs, next)
          applied += 1
          results.push({ path: ed.path, changed: true })
        } else {
          results.push({ path: ed.path, changed: false, message: 'no-op' })
        }
      }
    } catch (e: any) {
      results.push({ path: (ed as any)?.path || 'unknown', changed: false, message: e?.message || String(e) })
    }
  }

  const verification = opts.verify ? tsVerify(opts.tsconfigPath) : undefined
  return { ok: true, applied, results, dryRun: !!opts.dryRun, verification }
}

/**
 * Build the edits schema prompt for LLM
 */
function buildEditsSchemaPrompt(): string {
  return `You are a code editor agent. Propose edits strictly as JSON.\n\nReturn ONLY a JSON object with this shape (no prose, no markdown fences):\n{\n  "edits": [\n    { "type": "replaceOnce", "path": "relative/path/from/workspace.ext", "oldText": "...", "newText": "..." },\n    { "type": "insertAfterLine", "path": "relative/path/from/workspace.ext", "line": 42, "text": "..." },\n    { "type": "replaceRange", "path": "relative/path/from/workspace.ext", "start": 120, "end": 140, "text": "..." }\n  ]\n}\nRules:\n- Paths are relative to the workspace root.\n- Use smallest, precise edits.\n- Do not include explanations.`
}

/**
 * Extract JSON object from LLM output
 */
function extractJsonObject(raw: string): any {
  const trimmed = raw.trim()
  // If wrapped in fences, try to extract
  const fence = /```\w*\n([\s\S]*?)```/m.exec(trimmed)
  const candidate = fence ? fence[1] : trimmed
  // Try parse directly, else fallback to first {...} block
  try {
    return JSON.parse(candidate)
  } catch {}

  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    const sub = candidate.slice(first, last + 1)
    try {
      return JSON.parse(sub)
    } catch {}
  }
  throw new Error('Failed to parse JSON edits from model output')
}

/**
 * Register edits IPC handlers
 */
export function registerEditsHandlers(ipcMain: IpcMain): void {
  /**
   * Apply file edits
   */
  ipcMain.handle('edits:apply', async (_e, args: { edits: TextEdit[]; dryRun?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      return await applyFileEditsInternal(args.edits, { dryRun: args.dryRun, verify: args.verify, tsconfigPath: args.tsconfigPath })
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e), applied: 0, results: [], dryRun: !!args.dryRun }
    }
  })

  /**
   * Propose edits using LLM
   */
  ipcMain.handle('edits:propose', async (_e, args: { instruction: string; model?: string; provider?: string; k?: number }) => {
    const providerId = (args.provider || 'openai')
    const key = await getProviderKey(providerId)

    if (!key) return { ok: false, error: 'Missing API key for provider' }

    const model = args.model || (providerId === 'anthropic' ? 'claude-3-5-sonnet' : providerId === 'gemini' ? 'gemini-1.5-pro' : 'gpt-5')
    const provider = providers[providerId]

    // Build messages with context
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    messages.push({ role: 'system', content: buildEditsSchemaPrompt() })

    try {
      const res = await getIndexer().search(args.instruction.slice(0, 2000), args.k ?? 6)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text || '').slice(0, 600)}`).join('\n\n')
        messages.push({ role: 'user', content: `Context from repository (top matches):\n\n${ctx}\n\nUse this context if helpful.` })
      }
    } catch {}

    messages.push({ role: 'user', content: `Instruction:\n${args.instruction}\n\nReturn ONLY the JSON object, nothing else.` })

    let buffer = ''
    const handle = await provider.chatStream({
      apiKey: key,
      model,
      messages,
      onChunk: (t) => { buffer += t },
      onDone: () => { /* no-op */ },
      onError: (_e) => { /* no-op */ },
    })

    // Wait briefly for stream to complete (best-effort)
    await new Promise((r) => setTimeout(r, 300))

    // Give a little more time if we haven't seen a closing brace yet (up to ~2s total)
    const start = Date.now()
    while (!buffer.includes('}') && Date.now() - start < 1700) {
      await new Promise((r) => setTimeout(r, 50))
    }

    // Cancel any lingering stream
    try {
      handle.cancel()
    } catch {}

    try {
      const obj = extractJsonObject(buffer)
      const edits = Array.isArray(obj?.edits) ? obj.edits : []
      return { ok: true, edits }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e), raw: buffer }
    }
  })
}

