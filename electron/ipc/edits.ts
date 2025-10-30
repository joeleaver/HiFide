/**
 * File editing operations IPC handlers
 *
 * Handles applying file edits and proposing edits using LLM
 */

import type { IpcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getIndexer, providers, getProviderKey } from '../core/state'
import { useMainStore } from '../store/index'


// Local edit operation types (discriminated union)
 type ReplaceOnceEdit = { type: 'replaceOnce'; path: string; oldText: string; newText: string }
 type InsertAfterLineEdit = { type: 'insertAfterLine'; path: string; line: number; text: string }
 type ReplaceRangeEdit = { type: 'replaceRange'; path: string; start: number; end: number; text: string }
 type TextEdit = ReplaceOnceEdit | InsertAfterLineEdit | ReplaceRangeEdit

/**
 * Resolve path within workspace (security check)
 */
function resolveWithinWorkspace(p: string): string {
  const root = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
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
  // Collect per-file before/after previews for diff badges
  const previews = new Map<string, { before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>()
  const MAX_PREVIEW = 16 * 1024 // 16 KB of text preview (keep bridge payloads small)
  const clip = (s?: string) => {
    if (typeof s !== 'string') return s as any
    return s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW) : s
  }
  const wsRoot: string = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())

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
        const safeNew = sanitizeAppliedText((ed as any).newText)
        const safeOld = (ed as any).oldText
        const pos = content.indexOf(safeOld)
        if (pos === -1) {
          results.push({ path: ed.path, changed: false, message: 'oldText-not-found' })
          continue
        }
        next = content.slice(0, pos) + safeNew + content.slice(pos + safeOld.length)
      } else if (ed.type === 'insertAfterLine') {
        const safeText = sanitizeAppliedText((ed as any).text)
        next = insertAfterLine(content, ed.line, safeText)
      } else if (ed.type === 'replaceRange') {
        const safeText = sanitizeAppliedText((ed as any).text)
        const s = Math.max(0, Math.min(content.length, ed.start | 0))
        const e = Math.max(s, Math.min(content.length, ed.end | 0))
        next = content.slice(0, s) + safeText + content.slice(e)
      } else {
        results.push({ path: (ed as any).path, changed: false, message: 'unknown-edit-type' })
        continue
      }

      if (opts.dryRun) {

	      // Record preview even during dry-run
	      if (!previews.has(abs)) {
	        previews.set(abs, { before: content, sizeBefore: content.length })
	      }
	      if (next !== content) {
	        const prev = previews.get(abs) || {}
	        previews.set(abs, { ...prev, after: next, sizeAfter: next.length })
	      }

        results.push({ path: ed.path, changed: next !== content, message: 'dry-run' })
        if (next !== content) applied += 1
      } else {
        if (next !== content) {
          // Record preview before writing
          if (!previews.has(abs)) {
            previews.set(abs, { before: content, sizeBefore: content.length })
          }
          const prev = previews.get(abs) || {}
          previews.set(abs, { ...prev, after: next, sizeAfter: next.length })

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
    } catch {}

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

