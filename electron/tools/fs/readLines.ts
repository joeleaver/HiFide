/**
 * fsReadLines tool
 *
 * Read a small slice of a text file (by head/tail/range) or search with regex,
 * without loading the whole file. Enforces workspace-root sandboxing and strict limits.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'



// Limits
const DEFAULT_LINES = 250
const MAX_LINES = 500
const DEFAULT_MAX_BYTES = 256 * 1024 // 256 KiB
const DEFAULT_TIMEOUT_MS = 1000

// Types
type Mode = 'head' | 'tail' | 'range' | 'regex' | 'around'

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }

async function detectEncodingAndBinary(abs: string, maxCheck = 16384): Promise<{ encoding: 'utf8'|'utf16le'; isBinary: boolean; eol: 'lf'|'crlf'|'unknown' }>{
  const fd = await fs.open(abs, 'r')
  try {
    const { size } = await fd.stat()
    const len = Math.min(size, maxCheck)
    const buf = Buffer.alloc(Math.max(2, len))
    await fd.read(buf, 0, buf.length, 0)
    // BOM detection
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      // UTF-16LE BOM
      // EOL detection on UTF-16LE is expensive; leave unknown
      return { encoding: 'utf16le', isBinary: false, eol: 'unknown' }
    }
    // NUL heuristic for binary
    const hasNul = buf.includes(0x00)
    // EOL detection (best-effort on first chunk)
    let eol: 'lf'|'crlf'|'unknown' = 'unknown'
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0A) { // \n
        if (i > 0 && buf[i-1] === 0x0D) { eol = 'crlf' } else { eol = 'lf' }
        break
      }
    }
    return { encoding: 'utf8', isBinary: hasNul, eol }
  } finally {
    await fd.close().catch(() => {})
  }
}

function createLineReader(abs: string, encoding: BufferEncoding) {
  const stream = fssync.createReadStream(abs, { encoding, highWaterMark: 64 * 1024 })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  return { rl, stream }
}

async function readHead(abs: string, encoding: BufferEncoding, lines: number, maxBytes: number, timeoutMs: number) {
  const out: string[] = []
  let bytes = 0
  const timer = setTimeout(() => { try { rl.close() } catch {} }, timeoutMs)
  const { rl, stream } = createLineReader(abs, encoding)
  try {
    for await (const line of rl) {
      out.push(line)
      bytes += Buffer.byteLength(line + '\n', encoding)
      if (out.length >= lines || bytes > maxBytes) break
    }
  } finally {
    clearTimeout(timer)
    rl.close()
    stream.destroy()
  }
  return { lines: out, truncated: out.length >= lines || bytes > maxBytes }
}

async function readRange(abs: string, encoding: BufferEncoding, startLine: number, endLine: number, maxBytes: number, timeoutMs: number) {
  const out: string[] = []
  let idx = 0
  let bytes = 0
  const timer = setTimeout(() => { try { rl.close() } catch {} }, timeoutMs)
  const { rl, stream } = createLineReader(abs, encoding)
  try {
    for await (const line of rl) {
      idx++
      if (idx < startLine) continue
      if (idx > endLine) break
      out.push(line)
      bytes += Buffer.byteLength(line + '\n', encoding)
      if (bytes > maxBytes) break
    }
  } finally {
    clearTimeout(timer)
    rl.close()
    stream.destroy()
  }
  return { lines: out, truncated: out.length < (endLine - startLine + 1) }
}

async function readTail(abs: string, encoding: BufferEncoding, lines: number, maxBytes: number, timeoutMs: number) {
  // Efficient backwards read for UTF-8; fallback to forward scan for UTF-16LE
  if (encoding !== 'utf8') {
    // Fallback: forward scan keeping a ring buffer of last N lines
    const ring: string[] = []
    let bytes = 0
    const timer = setTimeout(() => { try { rl.close() } catch {} }, timeoutMs)
    const { rl, stream } = createLineReader(abs, encoding)
    try {
      for await (const line of rl) {
        ring.push(line)
        if (ring.length > lines) ring.shift()
        bytes += Buffer.byteLength(line + '\n', encoding)
        if (bytes > maxBytes) break
      }
    } finally {
      clearTimeout(timer)
      rl.close()
      stream.destroy()
    }
    return { lines: ring, truncated: false }
  }

  const stat = await fs.stat(abs)
  const fd = await fs.open(abs, 'r')
  const chunkSize = 64 * 1024
  let pos = stat.size
  let buf = ''
  const deadline = Date.now() + timeoutMs
  while (pos > 0 && (buf.split('\n').length - 1) <= lines && (stat.size - pos) < maxBytes) {
    const toRead = Math.min(chunkSize, pos)
    const b = Buffer.alloc(toRead)
    pos -= toRead
    await fd.read(b, 0, toRead, pos)
    buf = b.toString('utf8') + buf
    if (Date.now() > deadline) break
  }
  await fd.close().catch(() => {})
  let parts = buf.split(/\n/)
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  const tail = parts.slice(-lines)
  return { lines: tail, truncated: (parts.length) > lines }
}

function validateFlags(flags?: string): string {
  if (!flags) return ''
  const set = new Set(flags.split(''))
  const out: string[] = []
  if (set.has('i')) out.push('i')
  if (set.has('m')) out.push('m')
  return out.join('')
}

async function readRegex(abs: string, encoding: BufferEncoding, opts: { pattern: string; flags?: string; contextBefore?: number; contextAfter?: number; maxMatches?: number; maxBytes: number; timeoutMs: number; start?: number; end?: number }) {
  const flags = validateFlags(opts.flags)
  const re = new RegExp(opts.pattern, flags)
  const before = clamp(opts.contextBefore ?? 2, 0, 20)
  const after = clamp(opts.contextAfter ?? 2, 0, 20)
  const maxMatches = clamp(opts.maxMatches ?? 25, 1, 100)

  // Load file into memory for reliable context extraction (files are small by budget)
  const full = await fs.readFile(abs, encoding)
  const allLines = full.split(/\r?\n/)
  const startIdx = Math.max(0, (opts.start ? opts.start - 1 : 0))
  const endIdx = Math.min(allLines.length - 1, (opts.end ? opts.end - 1 : allLines.length - 1))

  const matches: any[] = []
  let bytes = 0
  for (let i = startIdx; i <= endIdx; i++) {
    const line = allLines[i]
    const m = line.match(re)
    bytes += Buffer.byteLength(line + '\n', encoding)
    if (m) {
      const ctxStart = Math.max(startIdx, i - before)
      const ctxEnd = Math.min(endIdx, i + after)
      const ctxBefore = allLines.slice(ctxStart, i)
      const ctxAfter = allLines.slice(i + 1, ctxEnd + 1)
      matches.push({
        line: i + 1,
        text: line,
        groups: m.slice(1),
        contextBefore: ctxBefore.map((t, k) => ({ line: i - (ctxBefore.length - k) + 1, text: t })),
        contextAfter: ctxAfter.map((t, j) => ({ line: i + j + 2, text: t }))
      })
    }
    if (bytes > opts.maxBytes) break
  }
  return { matches, truncated: matches.length >= maxMatches || bytes > opts.maxBytes }
}

export const readLinesTool: AgentTool = {
  name: 'fsReadLines',
  description: 'Read lines from a file. Modes: head, tail, range, around, regex.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      handle: { type: 'string' },
      mode: { type: 'string', enum: ['head', 'tail', 'range', 'regex', 'around'] },
      startLine: { type: 'integer' },
      endLine: { type: 'integer' },
      focusLine: { type: 'integer' },
      pattern: { type: 'string' },
    },
  },
  run: async (input: any, meta?: any) => {
    function fromB64<T=any>(h?: string): T | null {
      if (!h) return null
      try { return JSON.parse(Buffer.from(h, 'base64').toString('utf-8')) as T } catch { return null }
    }
    function isImportLine(s: string): boolean {
      return /^\s*(import\b|export\s+\{?|export\s+\*|export\s+default\b)/.test(s)
    }

    try {
      // Resolve path either from handle or path
      let rel: string | null = null
      let handleStart: number | null = null
      let handleEnd: number | null = null
      if (input.handle) {
        const parsed = fromB64<{ t:string; p:string; s:number; e:number }>(String(input.handle))
        if (parsed && parsed.t === 'h' && parsed.p) {
          rel = String(parsed.p)
          handleStart = Number(parsed.s || 1)
          handleEnd = Number(parsed.e || parsed.s || 1)
        }
      }
      if (!rel) {
        if (!input.path) return 'Error: path or handle is required'
        rel = String(input.path)
      }

      const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
      const st = await fs.stat(abs)
      if (!st.isFile()) return 'Error: Not a file'

      const det = await detectEncodingAndBinary(abs)
      const encoding = det.encoding as BufferEncoding
      const eol = det.eol || 'unknown'
      const eolStr = eol === 'crlf' ? '\r\n' : '\n'
      if (input.rejectIfBinary !== false && det.isBinary) return 'Error: Binary file not supported'

      // Normalize params
      const mode: Mode = input.mode || 'range'
      const maxBytes = clamp(Number(input.maxBytes ?? DEFAULT_MAX_BYTES), 1024, 1024*1024)
      const timeoutMs = DEFAULT_TIMEOUT_MS

      if (mode === 'head') {
        const n = clamp(Number(input.headLines ?? DEFAULT_LINES), 1, MAX_LINES)
        const r = await readHead(abs, encoding, n, maxBytes, timeoutMs)
        const text = r.lines.join(input?.normalizeEol === false ? eolStr : '\n')
        return text
      }

      if (mode === 'tail') {
        const n = clamp(Number(input.tailLines ?? DEFAULT_LINES), 1, MAX_LINES)
        const r = await readTail(abs, encoding, n, maxBytes, timeoutMs)
        const text = r.lines.join(input?.normalizeEol === false ? eolStr : '\n')
        return text
      }

      if (mode === 'regex') {
        const patt = typeof input.pattern === 'string' ? input.pattern : ''
        if (!patt) return ''
        const r = await readRegex(abs, encoding, {
          pattern: patt,
          flags: input.flags,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          maxMatches: input.maxMatches,
          maxBytes,
          timeoutMs,
          start: input.scanStartLine,
          end: input.scanEndLine,
        })
        const ms = Array.isArray(r.matches) ? r.matches : []
        if (!ms.length) return ''
        // Build a single contiguous window covering all matched blocks with their contexts
        let start = Number.MAX_SAFE_INTEGER
        let end = -1
        for (const m of ms as any[]) {
          const cb = Array.isArray(m?.contextBefore) ? m.contextBefore.length : 0
          const ca = Array.isArray(m?.contextAfter) ? m.contextAfter.length : 0
          const s = Math.max(1, Number(m?.line || 1) - cb)
          const e = Math.max(s, Number(m?.line || 1) + ca)
          if (s < start) start = s
          if (e > end) end = e
        }
        const r2 = await readRange(abs, encoding, start, end, maxBytes, timeoutMs)
        const text = r2.lines.join(input?.normalizeEol === false ? eolStr : '\n')
        return text
      }

      if (mode === 'around') {
        const focus = clamp(Number(input.focusLine || handleStart || 1), 1, Number.MAX_SAFE_INTEGER)
        const win = (input.window !== undefined && input.window !== null) ? clamp(Number(input.window), 0, MAX_LINES) : undefined
        let before = win !== undefined ? win : clamp(Number(input.beforeLines ?? 10), 0, MAX_LINES)
        let after = win !== undefined ? win : clamp(Number(input.afterLines ?? 10), 0, MAX_LINES)
        // ensure total window <= MAX_LINES
        let total = before + 1 + after
        if (total > MAX_LINES) {
          const over = total - MAX_LINES
          const reduceAfter = Math.min(after, Math.ceil(over / 2))
          after -= reduceAfter
          const reduceBefore = over - reduceAfter
          before = Math.max(0, before - reduceBefore)
          total = before + 1 + after
        }
        let start = Math.max(1, focus - before)
        let end = Math.max(start, focus + after)

        // Optionally expand upward to include contiguous import/export block
        if (input.expandImports) {
          try {
            const full = await fs.readFile(abs, encoding)
            const lines = full.split(/\r?\n/)
            let i = Math.max(1, start) - 2
            while (i >= 0 && (isImportLine(lines[i]) || /^\s*$/.test(lines[i]))) { i-- }
            start = Math.max(1, i + 2)
          } catch {}
        }

        const r = await readRange(abs, encoding, start, end, maxBytes, timeoutMs)
        const text = r.lines.join(input?.normalizeEol === false ? eolStr : '\n')
        return text
      }

      // range (default)
      let start = handleStart ?? Number(input.startLine || 1)
      let end = handleEnd ?? Number(input.endLine || (start + DEFAULT_LINES - 1))
      start = clamp(start, 1, Number.MAX_SAFE_INTEGER)
      end = clamp(end, start, start + MAX_LINES - 1)

      // Optionally expand upward to include contiguous import/export block
      if (input.expandImports) {
        try {
          const full = await fs.readFile(abs, encoding)
          const lines = full.split(/\r?\n/)
          let i = Math.max(1, start) - 2
          while (i >= 0 && (isImportLine(lines[i]) || /^\s*$/.test(lines[i]))) { i-- }
          start = Math.max(1, i + 2)
        } catch {}
      }

      const r = await readRange(abs, encoding, start, end, maxBytes, timeoutMs)
      const text = r.lines.join(input?.normalizeEol === false ? eolStr : '\n')
      return text
    } catch (e: any) {
      return `Error: ${e?.message || String(e)}`
    }
  },

  toModelResult: (raw: any) => {
    // For fs.read_lines, the result is typically a string or error
    // Store it in the cache for the badge viewer
    if (typeof raw === 'string' || (raw && typeof raw === 'object')) {
      const previewKey = randomUUID()
      return {
        minimal: typeof raw === 'string' ? { text: raw, previewKey } : { ...raw, previewKey },
        ui: raw,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

