/**
 * File editing operations IPC handlers
 *
 * Handles applying file edits and proposing edits using LLM
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getIndexer, providers, getProviderKey } from '../core/state'
import { ServiceRegistry } from '../services/base/ServiceRegistry.js'


// Local edit operation types (discriminated union)
type ReplaceOnceEdit = { type: 'replaceOnce'; path: string; oldText: string; newText: string }
type InsertAfterLineEdit = { type: 'insertAfterLine'; path: string; line: number; text: string }
type ReplaceRangeEdit = { type: 'replaceRange'; path: string; start: number; end: number; text: string }
type TextEdit = ReplaceOnceEdit | InsertAfterLineEdit | ReplaceRangeEdit

/**
 * Resolve path within workspace (security check)
 */
function resolveWithinWorkspace(p: string): string {
  const workspaceService = ServiceRegistry.get<any>('workspace')
  const root = path.resolve(workspaceService?.getWorkspaceRoot() || process.cwd())
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) {
    throw new Error('Path outside workspace')
  }
  return norm
}

/**
 * Atomic file write: write to a temp file in the same directory and rename over the original.
 * On Windows, rename() may fail if destination exists; in that case, unlink then rename.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`)
  await fs.writeFile(tmp, content, 'utf-8')
  try {
    await fs.rename(tmp, filePath)
  } catch (e: any) {
    try { await fs.unlink(filePath) } catch { }
    await fs.rename(tmp, filePath)
  }
}


/**
 * Apply file edits (internal implementation)
 */
export async function applyFileEditsInternal(
  edits: TextEdit[] = [],
  opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}
) {
  // Defensive sanitizer to prevent conversational/tool metadata from leaking into files
  const sanitizeAppliedText = (s: string | undefined): string => {
    if (typeof s !== 'string') return s as any
    let out = s
    // 1) Strip leading/trailing code fences ```lang ... ```
    const fenceStart = out.match(/^```[a-zA-Z0-9._-]*\s/)
    if (fenceStart) {
      out = out.replace(/^```[a-zA-Z0-9._-]*\s/, '')
      out = out.replace(/```\s*$/, '')
    }
    // 2) If LLM leaked tool-call markers, drop everything from that marker onward
    // Common patterns observed: to=functions.<toolName>
    out = out.replace(/\n?[^\n]*to=functions\.[A-Za-z0-9_.-]+[\s\S]*$/m, '')
    // 3) Remove obvious chat preambles accidentally embedded in code edits
    out = out.replace(/^\s*(Sure, here(?:'|)s|Here(?:'|)s|Okay,|Alright,)[^\n]*\n/, '')
    // 4) Trim stray unmatched closing fences if any remained
    out = out.replace(/```+\s*$/g, '')
    return out
  }
  // Detect the dominant EOL for a file and normalize new text to match it
  const detectEol = (s: string): string => {
    const crlf = (s.match(/\r\n/g) || []).length
    const totalLF = (s.split('\n').length - 1)
    const lfOnly = totalLF - crlf
    return crlf > lfOnly ? '\r\n' : '\n'
  }
  const normalizeEol = (s: string, eol: string): string => {
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, eol)
  }

  // Collect per-file before/after previews for diff badges
  const previews = new Map<string, { before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>()
  const MAX_PREVIEW = 16 * 1024 // 16 KB of text preview (keep bridge payloads small)
  const clip = (s?: string) => {
    if (typeof s !== 'string') return s as any
    return s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW) : s
  }
  const workspaceService = ServiceRegistry.get<any>('workspace')
  const wsRoot: string = path.resolve(workspaceService?.getWorkspaceRoot() || process.cwd())

  const results: Array<{ path: string; changed: boolean; message?: string }> = []
  let applied = 0

  // Group edits by file so we can apply them sequentially (in-order) and write once per file
  const perFile = new Map<string, { rel: string; original: string; current: string; eol: string; ops: Array<any> }>()

  // Read each file once and collect its edits preserving input order
  for (let i = 0; i < edits.length; i++) {
    const ed = edits[i]
    try {
      const abs = resolveWithinWorkspace(ed.path)
      let bucket = perFile.get(abs)
      if (!bucket) {
        let content = ''
        try { content = await fs.readFile(abs, 'utf-8') } catch (e: any) {
          results.push({ path: ed.path, changed: false, message: 'read-failed: ' + (e?.message || String(e)) })
          continue
        }
        bucket = { rel: ed.path, original: content, current: content, eol: detectEol(content), ops: [] }
        perFile.set(abs, bucket)
        if (!previews.has(abs)) previews.set(abs, { before: content, sizeBefore: content.length })
      }

      // Store the op; sanitize new text now, normalize to EOL during application
      if (ed.type === 'replaceOnce') {
        bucket.ops.push({ type: 'replaceOnce', idx: i, oldText: ed.oldText, newText: sanitizeAppliedText(ed.newText) })
      } else if (ed.type === 'insertAfterLine') {
        bucket.ops.push({ type: 'insertAfterLine', idx: i, line: ed.line | 0, text: sanitizeAppliedText(ed.text) })
      } else if (ed.type === 'replaceRange') {
        bucket.ops.push({ type: 'replaceRange', idx: i, start: ed.start | 0, end: ed.end | 0, text: sanitizeAppliedText(ed.text) })
      } else {
        results.push({ path: (ed as any).path, changed: false, message: 'unknown-edit-type' })
      }
    } catch (e: any) {
      results.push({ path: (ed as any)?.path || 'unknown', changed: false, message: e?.message || String(e) })
    }
  }

  // Apply per-file edits
  for (const [abs, bucket] of perFile.entries()) {
    const { rel } = bucket
    let curr = bucket.current
    const eol = bucket.eol

    // 1) Apply all replaceRange edits relative to the ORIGINAL content in a single pass
    const rangeOps = bucket.ops.filter((o: any) => o.type === 'replaceRange')
    if (rangeOps.length) {
      // Validate sequential, non-overlapping (relative to original)
      let prevEnd = -1
      for (const op of rangeOps) {
        const s0 = Math.max(0, Math.min(bucket.original.length, Number(op.start) | 0))
        const e0 = Math.max(s0, Math.min(bucket.original.length, Number(op.end) | 0))
        if (s0 < prevEnd) {
          results.push({ path: rel, changed: false, message: 'non-sequential-or-overlapping-ranges' })
          // Fallback: sort by start ascending to salvage best-effort
          rangeOps.sort((a: any, b: any) => (a.start | 0) - (b.start | 0))
          break
        }
        prevEnd = e0
      }

      let built = ''
      let cursor = 0
      for (const op of rangeOps) {
        const s0 = Math.max(0, Math.min(bucket.original.length, Number(op.start) | 0))
        const e0 = Math.max(s0, Math.min(bucket.original.length, Number(op.end) | 0))
        const beforeSlice = bucket.original.slice(s0, e0)
        // Normalize replacement to file EOL style
        let textNorm = normalizeEol(String(op.text || ''), eol)
        // Preserve boundary newline semantics for line-aligned ranges
        const hadTerminator = beforeSlice.endsWith('\n')
        if (hadTerminator && !textNorm.endsWith(eol)) textNorm += eol
        if (!hadTerminator) {
          // If original selection did not end with a newline (e.g., EOF without newline or mid-line),
          // do not introduce one in the replacement.
          while (textNorm.endsWith(eol)) textNorm = textNorm.slice(0, -eol.length)
        }
        const changed = beforeSlice !== textNorm
        if (changed) applied += 1
        // unchanged segment from original
        built += bucket.original.slice(cursor, s0)
        // replacement
        built += textNorm
        cursor = e0
        results.push({ path: rel, changed })
      }
      // tail
      built += bucket.original.slice(cursor)
      curr = built
    }

    // 2) Apply remaining edits (replaceOnce, insertAfterLine) relative to the evolving buffer, in input order
    for (const op of bucket.ops) {
      if (op.type === 'replaceRange') continue // already applied in pass 1
      if (op.type === 'replaceOnce') {
        const oldText = String(op.oldText || '')
        const pos = curr.indexOf(oldText)
        if (pos === -1) {
          results.push({ path: rel, changed: false, message: 'oldText-not-found' })
          continue
        }
        const newNorm = normalizeEol(String(op.newText || ''), eol)
        const changed = curr.slice(pos, pos + oldText.length) !== newNorm
        if (changed) {
          curr = curr.slice(0, pos) + newNorm + curr.slice(pos + oldText.length)
          applied += 1
        }
        results.push({ path: rel, changed })
      } else if (op.type === 'insertAfterLine') {
        const insNorm = normalizeEol(String(op.text || ''), eol)
        let pos = 0
        let insertText = ''
        const line = Number(op.line || 0)
        if (line <= 0) {
          pos = 0
          const addBreak = curr.startsWith(eol) ? '' : eol
          insertText = insNorm + (insNorm.endsWith(eol) ? '' : addBreak)
        } else {
          let idx = 0
          let current = 1
          while (current <= line && idx !== -1) {
            idx = curr.indexOf('\n', idx)
            if (idx === -1) break
            idx += 1
            current += 1
          }
          if (idx === -1) {
            pos = curr.length
            const prefix = curr.endsWith(eol) ? '' : eol
            insertText = prefix + insNorm
          } else {
            pos = idx
            insertText = insNorm.endsWith(eol) ? insNorm : (insNorm + eol)
          }
        }
        const changed = insertText.length > 0
        if (changed) {
          curr = curr.slice(0, pos) + insertText + curr.slice(pos)
          applied += 1
        }
        results.push({ path: rel, changed })
      }
    }

    const prev = previews.get(abs) || {}
    previews.set(abs, { ...prev, after: curr, sizeAfter: curr.length })

    if (!opts.dryRun && curr !== bucket.original) {
      await atomicWrite(abs, curr)
    }
  }


  const fileEditsPreview = Array.from(previews.entries()).map(([absPath, v]) => {
    const rel = path.relative(wsRoot, absPath)
    const truncated = (v.before && v.before.length > MAX_PREVIEW) || (v.after && v.after.length > MAX_PREVIEW)
    return {
      path: rel,
      before: clip(v.before),
      after: clip(v.after),
      sizeBefore: v.sizeBefore,
      sizeAfter: v.sizeAfter,
      truncated: !!truncated,
    }
  })

  const verification = undefined
  return { ok: true, applied, results, dryRun: !!opts.dryRun, verification, fileEditsPreview }
}


/**
 * Apply sequential, line-range edits to a single file.
 * - Accepts 1-based startLine/endLine (inclusive) ranges
 * - Ranges must be strictly sequential and non-overlapping (startLine > previous endLine)
 * - Internally normalizes input/output to LF; writes back using the file's original EOL style
 */
export async function applyLineRangeEditsInternal(
  relPath: string,
  ranges: Array<{ startLine: number; endLine: number; newText: string }>,
  opts: { dryRun?: boolean } = {}
) {
  // Sanitize LLM-provided text similarly to applyFileEditsInternal
  const sanitizeAppliedText = (s: string | undefined): string => {
    if (typeof s !== 'string') return s as any
    let out = s
    const fenceStart = out.match(/^```[a-zA-Z0-9._-]*\s/)
    if (fenceStart) {
      out = out.replace(/^```[a-zA-Z0-9._-]*\s/, '')
      out = out.replace(/```\s*$/, '')
    }
    out = out.replace(/\n?[^\n]*to=functions\.[A-Za-z0-9_.-]+[\s\S]*$/m, '')
    out = out.replace(/^\s*(Sure, here(?:'|)s|Here(?:'|)s|Okay,|Alright,)[^\n]*\n/, '')
    out = out.replace(/```+\s*$/g, '')
    return out
  }
  const detectEol = (s: string): string => {
    const crlf = (s.match(/\r\n/g) || []).length
    const totalLF = (s.split('\n').length - 1)
    const lfOnly = totalLF - crlf
    return crlf > lfOnly ? '\r\n' : '\n'
  }
  const toLF = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const fromLF = (s: string, eol: string): string => s.replace(/\n/g, eol)

  const abs = resolveWithinWorkspace(relPath)

  let original = ''
  try {
    original = await fs.readFile(abs, 'utf-8')

  } catch (e: any) {
    return { ok: false, error: 'read-failed: ' + (e?.message || String(e)) }
  }

  const originalEol = detectEol(original)
  const originalLF = toLF(original)

  // Helper: get index of the start of a 1-based line number within LF text
  const indexOfLineStart = (s: string, lineNo: number): number => {
    if (lineNo <= 1) return 0
    let idx = 0
    let current = 1
    while (current < lineNo) {
      const next = s.indexOf('\n', idx)
      if (next === -1) return s.length
      idx = next + 1
      current++
    }
    return idx
  }

  // Validate ranges are strictly sequential and non-overlapping
  let prevEnd = 0
  for (const r of ranges || []) {
    const s = Math.max(1, Number(r.startLine) | 0)
    const e = Math.max(s, Number(r.endLine) | 0)
    if (s <= prevEnd) {
      return { ok: false, error: 'non-sequential-or-overlapping-ranges' }
    }
    prevEnd = e
  }

  let resultLF = ''
  let cursor = 0 // index in originalLF
  const results: Array<{ path: string; changed: boolean; range: { startLine: number; endLine: number } }> = []
  let applied = 0

  for (const r of ranges || []) {
    const startLine = Math.max(1, Number(r.startLine) | 0)
    const endLine = Math.max(startLine, Number(r.endLine) | 0)

    const startIdx = indexOfLineStart(originalLF, startLine)
    const endIdx = indexOfLineStart(originalLF, endLine + 1)

    // Append unchanged segment before this range
    resultLF += originalLF.slice(cursor, startIdx)

    const newTextLFRaw = toLF(sanitizeAppliedText(r.newText || ''))
    const beforeSlice = originalLF.slice(startIdx, endIdx)

    // Defensive: avoid duplicate-first-line if replacement repeats the line preceding the range
    let newTextWork = newTextLFRaw
    if (startIdx > 0 && newTextWork.length) {
      // Find the line BEFORE the start index. The newline for the previous line is at startIdx - 1.
      // So search for the newline before that to get the previous line start.
      const prevBreak = originalLF.lastIndexOf('\n', Math.max(0, startIdx - 2))
      const prevStart = prevBreak === -1 ? 0 : (prevBreak + 1)
      const prevLine = originalLF.slice(prevStart, Math.max(0, startIdx - 1))
      const firstBreak = newTextWork.indexOf('\n')
      const firstLineNew = (firstBreak === -1 ? newTextWork : newTextWork.slice(0, firstBreak))
      if (prevLine.trimEnd().length && firstLineNew.trimEnd() === prevLine.trimEnd()) {
        // Drop the duplicated first line from replacement
        newTextWork = firstBreak === -1 ? '' : newTextWork.slice(firstBreak + 1)
      }
    }

    // Preserve the original boundary newline semantics:
    // - If the original slice ended with a newline, ensure the replacement also ends with a newline
    // - If it did not (e.g., last line without final newline), ensure the replacement does not end with a newline
    const hadTerminator = beforeSlice.endsWith('\n')
    let newTextLF = newTextWork
    if (hadTerminator && !newTextLF.endsWith('\n')) newTextLF += '\n'
    if (!hadTerminator && newTextLF.endsWith('\n')) newTextLF = newTextLF.replace(/\n+$/g, '')

    const changed = beforeSlice !== newTextLF
    if (changed) applied += 1

    // Append replacement
    resultLF += newTextLF

    // Advance cursor to end of this range in the original
    cursor = endIdx
    results.push({ path: relPath, changed, range: { startLine, endLine } })
  }

  // Append tail after the last range
  resultLF += originalLF.slice(cursor)

  const afterOut = fromLF(resultLF, originalEol)

  const previews = [{
    path: relPath,
    before: original,
    after: afterOut,
    sizeBefore: original.length,
    sizeAfter: afterOut.length,
    truncated: false,
  }]

  if (!opts.dryRun && afterOut !== original) {
    await atomicWrite(abs, afterOut)
  }

  return { ok: true, applied, results, dryRun: !!opts.dryRun, fileEditsPreview: previews }
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
  } catch { }

  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    const sub = candidate.slice(first, last + 1)
    try {
      return JSON.parse(sub)
    } catch { }
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
   * Apply sequential line-range edits (single file)
   */
  ipcMain.handle('edits:applyRanges', async (_e, args: { path: string; ranges: Array<{ startLine: number; endLine: number; newText: string }>; dryRun?: boolean }) => {
    try {
      return await applyLineRangeEditsInternal(args.path, args.ranges || [], { dryRun: args.dryRun })
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e), applied: 0, results: [], dryRun: !!args?.dryRun }
    }
  })

  /**
   * Propose edits using LLM (strict JSON schema via agentStream)
   */
  ipcMain.handle('edits:propose', async (_e, args: { instruction: string; model?: string; provider?: string; k?: number }) => {
    const providerId = (args.provider || 'openai')
    const key = await getProviderKey(providerId)

    if (!key) return { ok: false, error: 'Missing API key for provider' }

    const model = args.model || (providerId === 'anthropic' ? 'claude-3-5-sonnet' : providerId === 'gemini' ? 'gemini-1.5-pro' : 'gpt-5')
    const provider = providers[providerId]

    // Build messages with context
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    messages.push({ role: 'system', content: 'You are a code editor agent. Return ONLY JSON that follows the provided schema. No prose.' })

    try {
      const indexer = await getIndexer()
      const res = await indexer.search(args.instruction.slice(0, 2000), args.k ?? 6)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text || '').slice(0, 600)}`).join('\n\n')
        messages.push({ role: 'user', content: `Context from repository (top matches):\n\n${ctx}\n\nUse this context if helpful.` })
      }
    } catch { }

    messages.push({ role: 'user', content: `Instruction:\n${args.instruction}\n\nReturn ONLY the JSON object, nothing else.` })

    // Strict JSON Schema for edits
    const responseSchema = {
      name: 'proposed_edits',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['replaceOnce', 'insertAfterLine', 'replaceRange'] },
                path: { type: 'string' },
                oldText: { type: 'string' },
                newText: { type: 'string' },
                line: { type: 'integer' },
                text: { type: 'string' },
                start: { type: 'integer' },
                end: { type: 'integer' },
              },
              required: ['type', 'path']
            }
          }
        },
        required: ['edits'],
        additionalProperties: false
      }
    }

    let buffer = ''
    if (!provider.agentStream) {
      return { ok: false, error: 'Provider does not support agentStream' }
    }
    await provider.agentStream({
      apiKey: key,
      model,
      messages,
      tools: [],
      responseSchema,
      onChunk: (t: string) => { buffer += t },
      onDone: () => { /* no-op */ },
      onError: (_e: string) => { /* no-op */ },
    })

    try {
      const obj = extractJsonObject(buffer)
      const edits = Array.isArray(obj?.edits) ? obj.edits : []
      return { ok: true, edits }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e), raw: buffer }
    }
  })
}

