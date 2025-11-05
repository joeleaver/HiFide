import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, atomicWrite } from '../utils'
import fs from 'node:fs/promises'
import path from 'node:path'

import { randomUUID } from 'node:crypto'

// Minimal unified-diff parser and applier to emulate the popular CLI `apply_patch`
// Supports common git-style patches with: "diff --git ...", ---/+++ headers, and @@ hunks
// Handles new files (--- /dev/null) and deleted files (newPath = /dev/null or 'deleted file mode')

function extractPatchPayload(raw: string): string {
  if (!raw) return ''
  let s = String(raw)
  // Strip an opening fenced code block line entirely, including any attributes (e.g., ```diff filename=foo)
  s = s.replace(/^```[^\n]*\n/, '')
  // Strip a trailing closing fence
  s = s.replace(/```+\s*$/, '')
  // Try *** Begin Patch ... *** End Patch
  const beginIdx = s.indexOf('*** Begin Patch')
  const endIdx = s.indexOf('*** End Patch')
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Find the newline after "*** Begin Patch" and extract everything after it
    const startOfPatch = s.indexOf('\n', beginIdx)
    if (startOfPatch !== -1) {
      return s.slice(startOfPatch + 1, endIdx).trim()
    }
  }
  // Try apply_patch << 'PATCH' ... PATCH
  const apIdx = s.indexOf('apply_patch')
  if (apIdx !== -1) {
    const firstNL = s.indexOf('\n', apIdx)
    if (firstNL !== -1) {
      const body = s.slice(firstNL + 1)
      // find line that equals PATCH (possibly quoted earlier)
      const lines = body.split(/\r?\n/)
      const endLine = lines.findIndex((l) => l.trim() === 'PATCH')
      if (endLine !== -1) return lines.slice(0, endLine).join('\n')
      return body
    }
  }
  return s
}

function stripABPrefix(p: string): string {
  if (!p) return p
  if (p.startsWith('a/')) return p.slice(2)
  if (p.startsWith('b/')) return p.slice(2)
  return p
}

interface HunkLine { type: 'context' | 'add' | 'del'; text: string }
interface Hunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: HunkLine[] }
interface FilePatch { oldPath: string; newPath: string; hunks: Hunk[]; newFile: boolean; deletedFile: boolean }

function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.split(/\r?\n/)
  const files: FilePatch[] = []
  let i = 0

  const isPathLike = (s: string) => {
    const t = s.trim()
    if (!t || t.startsWith('diff --git') || t.startsWith('--- ') || t.startsWith('+++ ') || t.startsWith('@@') || t.startsWith('***') || t.startsWith('apply_patch') || t.startsWith('```')) return false
    if (/^\\ No newline at end of file$/.test(t)) return false
    // Heuristic: contains a path separator or a dot and no spaces
    return ((t.includes('/') || t.includes('\\') || t.includes('.')) && !/\s/.test(t))
  }
  const nextNonEmpty = (from: number) => {
    let j = from
    while (j < lines.length && lines[j].trim() === '') j++
    return j
  }

  while (i < lines.length) {
    const line = lines[i]

    // Case 1: full git header
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git\s+a\/(\S+)\s+b\/(\S+)/.exec(line)
      let oldPath = ''
      let newPath = ''
      if (m) { oldPath = m[1]; newPath = m[2] }
      i++
      let newFile = false
      let deletedFile = false
      // Scan until --- +++ or next diff
      while (i < lines.length && !lines[i].startsWith('--- ') && !lines[i].startsWith('diff --git ')) {
        const hdr = lines[i]
        if (/^new file mode /i.test(hdr)) newFile = true
        if (/^deleted file mode /i.test(hdr)) deletedFile = true
        i++
      }
      // Optional --- and +++
      if (i < lines.length && lines[i].startsWith('--- ')) {
        const mm = /^---\s+(.*)$/.exec(lines[i])
        if (mm) {
          const v = mm[1]
          if (v.includes('/dev/null')) oldPath = ''
          else oldPath = stripABPrefix(v.replace(/^a\//, '').trim())
        }
        i++
      }
      if (i < lines.length && lines[i].startsWith('+++ ')) {
        const mm = /^\+\+\+\s+(.*)$/.exec(lines[i])
        if (mm) {
          const v = mm[1]
          if (v.includes('/dev/null')) { newPath = '' ; deletedFile = true }
          else newPath = stripABPrefix(v.replace(/^b\//, '').trim())
        }
        i++
      }
      const fp: FilePatch = {
        oldPath: stripABPrefix(oldPath),
        newPath: stripABPrefix(newPath || oldPath),
        hunks: [],
        newFile: newFile || (oldPath === '' && newPath !== ''),
        deletedFile: deletedFile || (newPath === '' && oldPath !== ''),
      }
      // Hunks until next file header
      while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
        if (lines[i].startsWith('@@')) {
          const h = parseHunkHeader(lines[i])
          i++
          const hLines: HunkLine[] = []
          while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
            const l = lines[i]
            if (l.startsWith('--- ') || l.startsWith('+++ ')) { i++; continue }
            if (l === '\\ No newline at end of file') { i++; continue }
            if (l.length === 0) {
              hLines.push({ type: 'context', text: '' })
            } else if (l[0] === ' ') {
              hLines.push({ type: 'context', text: l.slice(1) })
            } else if (l[0] === '+') {
              hLines.push({ type: 'add', text: l.slice(1) })
            } else if (l[0] === '-') {
              hLines.push({ type: 'del', text: l.slice(1) })
            } else {
              break
            }
            i++
          }
          fp.hunks.push({ ...h, lines: hLines })
          continue
        }
        i++
      }
      files.push(fp)
      continue
    }

    // Case 2: minimal header starting with --- / +++
    if (line.startsWith('--- ')) {
      let oldPath = ''
      let newPath = ''
      let newFile = false
      let deletedFile = false
      const mmOld = /^---\s+(.*)$/.exec(line)
      if (mmOld) {
        const v = mmOld[1]
        if (v.includes('/dev/null')) oldPath = ''
        else oldPath = stripABPrefix(v.replace(/^a\//, '').trim())
      }
      i++
      if (i < lines.length && lines[i].startsWith('+++ ')) {
        const mmNew = /^\+\+\+\s+(.*)$/.exec(lines[i])
        if (mmNew) {
          const v = mmNew[1]
          if (v.includes('/dev/null')) { newPath = '' ; deletedFile = true }
          else newPath = stripABPrefix(v.replace(/^b\//, '').trim())
        }
        i++
      }
      const fp: FilePatch = {
        oldPath: stripABPrefix(oldPath),
        newPath: stripABPrefix(newPath || oldPath),
        hunks: [],
        newFile: newFile || (oldPath === '' && newPath !== ''),
        deletedFile: deletedFile || (newPath === '' && oldPath !== ''),
      }
      while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
        if (lines[i].startsWith('@@')) {
          const h = parseHunkHeader(lines[i])
          i++
          const hLines: HunkLine[] = []
          while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
            const l = lines[i]
            if (l.startsWith('--- ') || l.startsWith('+++ ')) { i++; continue }
            if (l === '\\ No newline at end of file') { i++; continue }
            if (l.length === 0) {
              hLines.push({ type: 'context', text: '' })
            } else if (l[0] === ' ') {
              hLines.push({ type: 'context', text: l.slice(1) })
            } else if (l[0] === '+') {
              hLines.push({ type: 'add', text: l.slice(1) })
            } else if (l[0] === '-') {
              hLines.push({ type: 'del', text: l.slice(1) })
            } else {
              break
            }
            i++
          }
          fp.hunks.push({ ...h, lines: hLines })
          continue
        }
        i++
      }
      files.push(fp)
      continue
    }

    // Case 3: "udiff-simple" (Gemini): first line is a path, followed by @@ hunks (no ---/+++ lines)
    if (isPathLike(line)) {
      const pathLine = line.trim().replace(/\\/g, '/')
      const j = nextNonEmpty(i + 1)
      if (j < lines.length && lines[j].startsWith('@@')) {
        const fp: FilePatch = { oldPath: pathLine, newPath: pathLine, hunks: [], newFile: false, deletedFile: false }
        i = j
        while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
          if (isPathLike(lines[i])) {
            // next file block starts when next non-empty after this is a hunk header
            const k = nextNonEmpty(i + 1)
            if (k < lines.length && lines[k].startsWith('@@')) break
          }
          if (lines[i].startsWith('@@')) {
            const h = parseHunkHeader(lines[i])
            i++
            const hLines: HunkLine[] = []
            while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- ')) {
              const l = lines[i]
              if (l === '\\ No newline at end of file') { i++; continue }
              if (l.length === 0) {
                hLines.push({ type: 'context', text: '' })
              } else if (l[0] === ' ') {
                hLines.push({ type: 'context', text: l.slice(1) })
              } else if (l[0] === '+') {
                hLines.push({ type: 'add', text: l.slice(1) })
              } else if (l[0] === '-') {
                hLines.push({ type: 'del', text: l.slice(1) })
              } else {
                break
              }
              i++
            }
            fp.hunks.push({ ...h, lines: hLines })
            continue
          }
          i++
        }
        files.push(fp)
        continue
      }
    }

    i++
  }

  return files
}

function parseHunkHeader(h: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } {
  // @@ -oldStart,oldCount +newStart,newCount @@
  const m = /^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/.exec(h)
  if (!m) return { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0 }
  const os = parseInt(m[1], 10)
  const oc = m[2] ? parseInt(m[2], 10) : 1
  const ns = parseInt(m[3], 10)
  const nc = m[4] ? parseInt(m[4], 10) : 1
  return { oldStart: os, oldCount: oc, newStart: ns, newCount: nc }
}

function applyHunksToContent(original: string, hunks: Hunk[]): { ok: boolean; content?: string; error?: string } {
  const src = original.split(/\r?\n/)
  const out: string[] = []
  let oldIdx = 1 // 1-based indexing for source

  for (const h of hunks) {
    // Copy unchanged lines up to oldStart-1
    while (oldIdx < h.oldStart && oldIdx <= src.length) {
      out.push(src[oldIdx - 1])
      oldIdx++
    }
    // Apply hunk lines
    for (const ln of h.lines) {
      if (ln.type === 'context') {
        const cur = src[oldIdx - 1] ?? ''
        if (cur !== ln.text) {
          return { ok: false, error: `context mismatch near line ${oldIdx}` }
        }
        out.push(cur)
        oldIdx++
      } else if (ln.type === 'del') {
        const cur = src[oldIdx - 1] ?? ''
        if (cur !== ln.text) {
          return { ok: false, error: `delete mismatch near line ${oldIdx}` }
        }
        // skip (delete)
        oldIdx++
      } else if (ln.type === 'add') {
        out.push(ln.text)
      }
    }
  }
  // Copy remaining
  while (oldIdx <= src.length) {
    out.push(src[oldIdx - 1])
    oldIdx++
  }
  return { ok: true, content: out.join('\n') }
}

export const applyPatchTool: AgentTool = {
  name: 'applyPatch',
  description: 'Apply a unified-diff patch (git-style). Accepts raw patch, fenced diff, or *** Begin/End Patch markers. Use dryRun to preview; for small, precise changes prefer applyEdits or codeApplyEditsTargeted.',
  parameters: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'Unified diff patch text in standard git diff format. Must include diff headers, --- / +++ lines, @@ hunk headers, and properly prefixed hunk lines (space/+/-).'
      },
      strip: {
        type: 'integer',
        description: 'Number of leading path components to strip (like git apply -pN). Usually 0 or 1. Auto-detected for a/ b/ prefixes.',
        minimum: 0,
        maximum: 10
      },
      dryRun: {
        type: 'boolean',
        description: 'If true, validate and preview changes without writing to disk. Always use dryRun:true first to verify the patch.'
      }
    },
    required: ['patch']
  },
  run: async (args: { patch: string; strip?: number; dryRun?: boolean }) => {
    try {
      const raw = String(args?.patch || '')
      const payload = extractPatchPayload(raw)
      if (!payload.trim()) return { ok: false, error: 'Empty patch payload' }

      const filePatches = parseUnifiedDiff(payload)
      if (!filePatches.length) return { ok: false, error: 'No file diffs found in patch' }

      const previews: Array<{ path: string; before: string; after: string; sizeBefore: number; sizeAfter: number; truncated?: boolean }> = []
      const results: Array<{ path: string; changed: boolean; message?: string }> = []
      let applied = 0

      for (const fp of filePatches) {
        let relPath = stripABPrefix(fp.deletedFile ? fp.oldPath : fp.newPath)
        if (!relPath) continue
        // Optional -p style strip
        const stripN = (typeof args?.strip === 'number' && args.strip > 0) ? Math.min(10, Math.max(0, Math.floor(args.strip))) : 0
        if (stripN > 0) {
          const parts = relPath.split('/')
          if (parts.length > stripN) relPath = parts.slice(stripN).join('/')
        }
        const wsAbs = resolveWithinWorkspace(relPath)

        let before = ''
        let exists = true
        try {
          before = await fs.readFile(wsAbs, 'utf-8')
        } catch {
          exists = false
          before = ''
        }

        if (fp.deletedFile) {
          const after = ''
          if (!args?.dryRun && exists) {
            try { await fs.unlink(wsAbs) } catch {}
          }
          // Verify deletion when not dryRun
          let msg: string | undefined
          if (!args?.dryRun) {
            try { await fs.access(wsAbs); msg = 'delete-verify-failed' } catch {}
          }
          previews.push({ path: relPath, before, after, sizeBefore: before.length, sizeAfter: after.length })
          results.push({ path: relPath, changed: true, message: msg })
          applied++
          continue
        }

        // New or modified file via hunks
        const base = exists ? before : ''
        const appliedRes = applyHunksToContent(base, fp.hunks)
        if (!appliedRes.ok) {
          return { ok: false, error: `Failed to apply patch for ${relPath}: ${appliedRes.error}` }
        }
        const after = appliedRes.content || ''
        // Write and verify when changed
        if (before !== after) {
          if (!args?.dryRun) {
            // Ensure containing dir exists
            try { await fs.mkdir(path.dirname(wsAbs), { recursive: true }) } catch {}
            await atomicWrite(wsAbs, after)
          }
          // Verify write when not dryRun
          let msg: string | undefined
          if (!args?.dryRun) {
            try { await fs.access(wsAbs) } catch { msg = 'write-verify-failed' }
          }
          previews.push({ path: relPath, before, after, sizeBefore: before.length, sizeAfter: after.length })
          results.push({ path: relPath, changed: true, message: msg })
          applied++
        } else {
          previews.push({ path: relPath, before, after, sizeBefore: before.length, sizeAfter: after.length })
          results.push({ path: relPath, changed: false })
        }
      }

      return {
        ok: true,
        applied,
        results,
        dryRun: !!args?.dryRun,
        fileEditsPreview: previews,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
  toModelResult: (raw: any) => {
    if (raw?.fileEditsPreview && Array.isArray(raw.fileEditsPreview)) {
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: !!raw.ok,
          applied: raw.applied ?? 0,
          results: Array.isArray(raw.results) ? raw.results : [],
          dryRun: !!raw.dryRun,
          previewKey,
          previewCount: raw.fileEditsPreview.length
        },
        ui: raw.fileEditsPreview,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

export default applyPatchTool;

