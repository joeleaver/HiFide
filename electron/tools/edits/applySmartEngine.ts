import fs from 'node:fs/promises'
import path from 'node:path'
import ignore from 'ignore'
import { resolveWithinWorkspace, atomicWrite } from '../utils'
import { grepTool } from '../text/grep'
import { applyPatchTool } from './applyPatch'

export type ApplyResult = {
  ok: boolean
  applied: number
  results: Array<{ path: string; changed: boolean; message?: string }>
  fileEditsPreview?: Array<{ path: string; before: string; after: string; sizeBefore?: number; sizeAfter?: number }>
  error?: string
}

// --- EOL/BOM helpers ---
function detectEol(s: string): string {
  const crlf = (s.match(/\r\n/g) || []).length
  const totalLF = (s.split('\n').length - 1)
  const lfOnly = totalLF - crlf
  return crlf > lfOnly ? '\r\n' : '\n'
}
const toLF = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const fromLF = (s: string, eol: string): string => s.replace(/\n/g, eol)

function sanitizePayload(raw: string): string {
  if (!raw) return ''
  let s = String(raw)
  // Strip leading/trailing code fences (remove entire opening fence line, including attributes)
  s = s.replace(/^```[^\n]*\n/, '')
  s = s.replace(/```+\s*$/g, '')
  return s.trim()
}

// --- deny/allow checks ---
const DEFAULT_DENY_FOLDERS = new Set([
  '.git','node_modules','dist','dist-electron','release','.next','out','build','.turbo','.cache','target','vendor','.pnpm-store',
  '.venv','venv','.idea','.hifide-public','.hifide_public','.hifide-private','.hifide_private'
])

function isDeniedRel(rel: string): boolean {
  const norm = path.normalize(rel).split(path.sep)
  const top = norm[0] || ''
  return DEFAULT_DENY_FOLDERS.has(top)
}

async function loadGitignoreFilter(root: string): Promise<null | ((relPosix: string) => boolean)> {
  try {
    const gi = await fs.readFile(path.join(root, '.gitignore'), 'utf-8')
    const ig = ignore(); ig.add(gi)
    const filter = ig.createFilter()
    return (relPosix: string) => filter(relPosix)
  } catch { return null }
}

// --- format detection ---
function looksUnifiedDiff(s: string): boolean {
  // Accept git-style (diff --git ...), minimal (--- / +++), and udiff-simple with only @@ hunks
  return /^(diff --git |---\s|\+\+\+\s|@@\s)/m.test(s)
}
function looksOpenAiPatch(s: string): boolean {
  return /\*\*\*\s*Begin Patch[\s\S]*\*\*\*\s*End Patch/.test(s) && /\*\*\*\s*(Update|Add|New|Delete) File:/i.test(s)
}
function looksSearchReplace(s: string): boolean {
  return /^<<<<<<<\s*SEARCH/m.test(s)
}

// --- OpenAI Patch parsing/apply ---
type OAIGroup = { oldText: string; newText: string }
type OAIOp = { kind: 'update'; path: string; groups: OAIGroup[] } | { kind: 'create'; path: string; content: string } | { kind: 'delete'; path: string }

function parseOpenAiPatch(raw: string): OAIOp[] {
  const begin = raw.indexOf('*** Begin Patch')
  const end = raw.indexOf('*** End Patch')
  const body = begin !== -1 && end !== -1 && end > begin ? raw.slice(raw.indexOf('\n', begin) + 1, end) : raw
  const lines = body.split(/\r?\n/)
  const ops: OAIOp[] = []
  let cur: { type: 'update'|'create'|'delete'; path: string; buf: string[] } | null = null
  let inHunk = false
  let curMinus: string[] = []
  let curPlus: string[] = []

  const flushGroup = () => {
    if (!cur || cur.type !== 'update') return
    if (curMinus.length || curPlus.length) {
      const oldText = curMinus.join('\n')
      const newText = curPlus.join('\n')
      ;(cur as any).groups.push({ oldText, newText })
      curMinus = []; curPlus = []
    }
  }
  const flushOp = () => {
    if (!cur) return
    if (cur.type === 'update') {
      ops.push({ kind: 'update', path: cur.path, groups: (cur as any).groups || [] })
    } else if (cur.type === 'create') {
      ops.push({ kind: 'create', path: cur.path, content: cur.buf.join('\n') })
    } else if (cur.type === 'delete') {
      ops.push({ kind: 'delete', path: cur.path })
    }
    cur = null; inHunk = false; curMinus = []; curPlus = []
  }

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const mUpd = /^\*\*\*\s*Update File:\s*(.+)$/.exec(L)
    const mAdd = /^\*\*\*\s*(?:Add|New) File:\s*(.+)$/.exec(L)
    const mDel = /^\*\*\*\s*Delete File:\s*(.+)$/.exec(L)
    if (mUpd || mAdd || mDel) { flushGroup(); flushOp();
      const p = (mUpd?.[1] || mAdd?.[1] || mDel?.[1] || '').trim()
      if (mUpd) cur = { type: 'update', path: p, buf: [] } as any, (cur as any).groups = []
      else if (mAdd) cur = { type: 'create', path: p, buf: [] }
      else cur = { type: 'delete', path: p, buf: [] }
      continue
    }
    if (!cur) continue
    if (cur.type === 'delete') continue

    if (cur.type === 'create') { cur.buf.push(L); continue }

    if (/^@@/.test(L)) { inHunk = true; flushGroup(); continue }
    if (!inHunk) continue
    if (L.startsWith('+')) { curPlus.push(L.slice(1)) }
    else if (L.startsWith('-')) { curMinus.push(L.slice(1)) }
    else if (L.startsWith(' ')) { /* ignore context for now */ }
    else if (L.trim() === '') { /* allow blank context lines */ }
    else { /* unknown line inside hunk: ignore */ }
  }
  flushGroup(); flushOp()
  return ops
}

// Heuristic: Some models emit OpenAI Patch "Add File" content with leading '+' on each line.
// If the majority of non-empty lines start with '+', strip a single leading '+' from those lines.
function normalizeCreateContentFromOpenAiPatch(contentLF: string): string {
  const lines = contentLF.split('\n')
  const nonEmpty = lines.filter((l) => l.length > 0)
  const plusCount = nonEmpty.filter((l) => l.startsWith('+')).length
  const minusCount = nonEmpty.filter((l) => l.startsWith('-')).length
  // Consider it "diff-like" content if there are no '-' lines and a clear majority of '+' lines
  const isDiffLike = plusCount >= Math.max(3, Math.floor(nonEmpty.length * 0.6)) && minusCount === 0
  if (!isDiffLike) return contentLF
  return lines.map((l) => (l.startsWith('+') ? l.slice(1) : l)).join('\n')
}


// Layered matcher: exact -> whitespace-insensitive -> indent-insensitive -> anchor by first line
function findReplaceOnce(hayLF: string, oldLF: string): null | { start: number; end: number } {
  if (!oldLF) return null
  // exact
  let idx = hayLF.indexOf(oldLF)
  if (idx !== -1) return { start: idx, end: idx + oldLF.length }
  // whitespace-insensitive (collapse runs of space/tabs)
  const norm = (s: string) => s.replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n')
  const H = norm(hayLF), O = norm(oldLF)
  idx = H.indexOf(O)
  if (idx !== -1) {
    // Map back roughly: use first occurrence of first non-empty line as anchor
    const first = (oldLF.split('\n').find(l => l.trim().length) || '').trim()
    if (first) {
      const pos = hayLF.indexOf(first)
      if (pos !== -1) return { start: pos, end: pos + (oldLF.length) }
    }
  }
  // indent-insensitive: compare left-trimmed lines across window length
  const oldLines = oldLF.split('\n')
  const hayLines = hayLF.split('\n')
  const olen = oldLines.length
  const lt = (s: string) => s.replace(/^\s+/, '')
  for (let i = 0; i + olen <= hayLines.length; i++) {
    let ok = true
    for (let j = 0; j < olen; j++) {
      if (lt(hayLines[i + j]) !== lt(oldLines[j])) { ok = false; break }
    }
    if (ok) {
      const start = hayLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
      const end = start + oldLF.length
      return { start, end }
    }
  }
  // anchor by first non-empty line
  const first = oldLines.find(l => l.trim().length)
  if (first) {
    const candIdx: number[] = []
    let pos = hayLF.indexOf(first)
    while (pos !== -1) { candIdx.push(pos); pos = hayLF.indexOf(first, pos + 1) }
    if (candIdx.length === 1) {
      const start = candIdx[0]
      const end = start + oldLF.length
      return { start, end }
    }
  }
  return null
}

// --- Search/Replace blocks ---
type SRBlock = { path?: string; search: string; replace: string }
function parseSearchReplace(raw: string): SRBlock[] {
  const lines = raw.split(/\r?\n/)
  const blocks: SRBlock[] = []
  let curPath: string | undefined
  const isPathLike = (s: string) => {
    const t = s.trim()
    if (!t || /^File:\s*/.test(t) || /^<<<<<<<\s*SEARCH/.test(t) || /^=======/.test(t) || /^>>>>>>>\s*REPLACE/.test(t) || /^```/.test(t)) return false
    return ((t.includes('/') || t.includes('\\') || /\.[A-Za-z0-9_-]+$/.test(t)) && !/\s/.test(t))
  }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const mFile = /^File:\s*(.+)$/.exec(L)
    if (mFile) { curPath = mFile[1].trim(); continue }
    if (/^<<<<<<<\s*SEARCH/.test(L)) {
      // Diff-fenced variant: filename on the line just above the SEARCH block
      const prev = i > 0 ? lines[i - 1] : ''
      if (prev && isPathLike(prev)) curPath = prev.trim()
      const sBuf: string[] = []
      i++
      while (i < lines.length && !/^=======/.test(lines[i])) { sBuf.push(lines[i]); i++ }
      if (i >= lines.length) break
      i++
      const rBuf: string[] = []
      while (i < lines.length && !/^>>>>>>>\s*REPLACE/.test(lines[i])) { rBuf.push(lines[i]); i++ }
      blocks.push({ path: curPath, search: sBuf.join('\n'), replace: rBuf.join('\n') })
    }
  }
  return blocks
}

// --- Main entry ---
export async function applyEditsPayload(rawPayload: string): Promise<ApplyResult> {
  const payload = sanitizePayload(rawPayload)
  if (!payload) return { ok: false, applied: 0, results: [], error: 'empty-payload' }

  const root = resolveWithinWorkspace('.')
  const gitFilter = await loadGitignoreFilter(root)
  const respectGit = (rel: string) => {
    const relPosix = rel.split(path.sep).join('/')
    return gitFilter ? gitFilter(relPosix) : true
  }

  // Unified diff path: delegate to existing tool
  if (looksUnifiedDiff(payload) && !looksOpenAiPatch(payload)) {
    const r: any = await applyPatchTool.run({ patch: payload })
    if (r && r.ok) return r
    return { ok: false, applied: 0, results: [], error: r?.error || 'apply-patch-failed' }
  }

  const previews: Array<{ path: string; before: string; after: string; sizeBefore: number; sizeAfter: number }> = []
  const results: Array<{ path: string; changed: boolean; message?: string }> = []
  let applied = 0

  // OpenAI Patch
  if (looksOpenAiPatch(payload)) {
    const ops = parseOpenAiPatch(payload)
    for (const op of ops) {
      const rel = path.normalize(op.path)
      if (!respectGit(rel)) { results.push({ path: rel, changed: false, message: 'gitignored' }); continue }
      if (isDeniedRel(rel)) { results.push({ path: rel, changed: false, message: 'denied-path' }); continue }
      const abs = resolveWithinWorkspace(rel)
      if (op.kind === 'delete') {
        let before = ''
        try { before = await fs.readFile(abs, 'utf-8') } catch {}
        try { await fs.unlink(abs) } catch (e: any) { results.push({ path: rel, changed: false, message: 'delete-failed: ' + (e?.message || String(e)) }); continue }
        // Verify deletion
        try { await fs.access(abs); results.push({ path: rel, changed: true, message: 'delete-verify-failed' }) }
        catch { results.push({ path: rel, changed: true }) }
        previews.push({ path: rel, before, after: '', sizeBefore: before.length, sizeAfter: 0 })
        applied++
        continue
      }
      if (op.kind === 'create') {
        const rawLF = toLF(op.content)
        const contentLF = normalizeCreateContentFromOpenAiPatch(rawLF)
        const eol = '\n'
        const absDir = path.dirname(abs)
        try { await fs.mkdir(absDir, { recursive: true }) } catch {}
        const finalText = fromLF(contentLF, eol)
        await atomicWrite(abs, finalText)
        // Verify creation
        try { await fs.access(abs) }
        catch { previews.push({ path: rel, before: '', after: finalText, sizeBefore: 0, sizeAfter: contentLF.length }); results.push({ path: rel, changed: false, message: 'create-verify-failed' }); continue }
        previews.push({ path: rel, before: '', after: finalText, sizeBefore: 0, sizeAfter: contentLF.length })
        results.push({ path: rel, changed: true })
        applied++
        continue
      }
      // update
      let before = ''
      try { before = await fs.readFile(abs, 'utf-8') } catch (e: any) { results.push({ path: rel, changed: false, message: 'read-failed: ' + (e?.message || String(e)) }); continue }
      const eol = detectEol(before)
      let curLF = toLF(before)
      let changed = false
      let failures = 0
      for (const g of op.groups) {
        const oldLF = toLF(g.oldText)
        const newLF = toLF(g.newText)
        const loc = findReplaceOnce(curLF, oldLF)
        if (!loc) { failures++; continue }
        curLF = curLF.slice(0, loc.start) + newLF + curLF.slice(loc.end)
        changed = true
      }
      const after = fromLF(curLF, eol)
      previews.push({ path: rel, before, after, sizeBefore: before.length, sizeAfter: after.length })
      if (changed) { await atomicWrite(abs, after); applied++ }
      results.push({ path: rel, changed, message: failures ? `partial-ok ${op.groups.length - failures}/${op.groups.length}` : undefined })
    }
    return { ok: true, applied, results, fileEditsPreview: previews }
  }

  // Search/Replace blocks
  if (looksSearchReplace(payload)) {
    const blocks = parseSearchReplace(payload)
    for (const b of blocks) {
      let rel = b.path ? path.normalize(b.path) : undefined
      if (!rel) {
        // pathless: anchor by first non-empty line of search
        const first = (b.search.split('\n').find(l => l.trim().length) || '').trim()
        if (!first) { results.push({ path: '(unknown)', changed: false, message: 'empty-search' }); continue }
        const res: any = await grepTool.run({ pattern: first, files: ['**/*'], options: { literal: true, filenamesOnly: false, lineNumbers: true } })
        if (!res || !res.ok) { results.push({ path: '(unknown)', changed: false, message: 'search-failed' }); continue }
        // gather candidate files and verify exact multi-line presence
        const candidateSet = new Set<string>((res.data?.matches || []).map((m: any) => String(m.file || '')))
        const candidates: string[] = Array.from(candidateSet)
        const exactHits: string[] = []
        for (const file of candidates) {
          if (!file) continue
          if (!respectGit(file) || isDeniedRel(file)) continue
          const absF = resolveWithinWorkspace(file)
          try {
            const text = await fs.readFile(absF, 'utf-8')
            if (toLF(text).includes(toLF(b.search))) exactHits.push(file)
          } catch {}
        }
        if (exactHits.length !== 1) { results.push({ path: '(unknown)', changed: false, message: exactHits.length === 0 ? 'no-unique-match' : 'ambiguous-match' }); continue }
        rel = exactHits[0]
      }
      if (!respectGit(rel)) { results.push({ path: rel, changed: false, message: 'gitignored' }); continue }
      if (isDeniedRel(rel)) { results.push({ path: rel, changed: false, message: 'denied-path' }); continue }
      const abs = resolveWithinWorkspace(rel)
      let before = ''
      try { before = await fs.readFile(abs, 'utf-8') } catch (e: any) { results.push({ path: rel, changed: false, message: 'read-failed: ' + (e?.message || String(e)) }); continue }
      const eol = detectEol(before)
      const hay = toLF(before)
      const oldLF = toLF(b.search)
      const newLF = toLF(b.replace)
      const loc = findReplaceOnce(hay, oldLF)
      if (!loc) { results.push({ path: rel, changed: false, message: 'no-match' }); previews.push({ path: rel, before, after: before, sizeBefore: before.length, sizeAfter: before.length }); continue }
      const afterLF = hay.slice(0, loc.start) + newLF + hay.slice(loc.end)
      const after = fromLF(afterLF, eol)
      await atomicWrite(abs, after)
      applied++
      results.push({ path: rel, changed: true })
      previews.push({ path: rel, before, after, sizeBefore: before.length, sizeAfter: after.length })
    }
    return { ok: true, applied, results, fileEditsPreview: previews }
  }

  return { ok: false, applied: 0, results: [], error: 'unrecognized-format' }
}

