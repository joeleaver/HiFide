/**
 * fs.read_lines tool
 * 
 * Read a small slice of a text file (by head/tail/range) or search with regex,
 * without loading the whole file. Enforces workspace-root sandboxing and strict limits.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import readline from 'node:readline'

// Limits
const DEFAULT_LINES = 250
const MAX_LINES = 500
const DEFAULT_MAX_BYTES = 256 * 1024 // 256 KiB
const DEFAULT_TIMEOUT_MS = 1000

// Types
type Mode = 'head' | 'tail' | 'range' | 'regex' | 'around'

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }

async function detectEncodingAndBinary(abs: string, maxCheck = 16384): Promise<{ encoding: 'utf8'|'utf16le'; isBinary: boolean }>{
  const fd = await fs.open(abs, 'r')
  try {
    const { size } = await fd.stat()
    const len = Math.min(size, maxCheck)
    const buf = Buffer.alloc(Math.max(2, len))
    await fd.read(buf, 0, buf.length, 0)
    // BOM detection
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      // UTF-16LE BOM
      return { encoding: 'utf16le', isBinary: false }
    }
    // NUL heuristic for binary
    const hasNul = buf.includes(0x00)
    return { encoding: 'utf8', isBinary: hasNul }
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
  const parts = buf.split(/\n/)
  const tail = parts.slice(-lines)
  return { lines: tail, truncated: parts.length - 1 > lines }
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

  const matches: any[] = []
  const window: string[] = []
  let idx = 0
  let bytes = 0
  const timer = setTimeout(() => { try { rl.close() } catch {} }, opts.timeoutMs)
  const { rl, stream } = createLineReader(abs, encoding)
  try {
    for await (const line of rl) {
      idx++
      if (opts.start && idx < opts.start) continue
      if (opts.end && idx > opts.end) break

      // Maintain before-context window
      window.push(line)
      if (window.length > before + 1) window.shift()

      const m = line.match(re)
      bytes += Buffer.byteLength(line + '\n', encoding)
      if (m) {
        const ctxBefore = window.slice(0, Math.max(0, window.length - 1))
        const ctxAfter: string[] = []
        // Pull after-context by peeking next lines from rl - not supported directly; instead
        // we will read them synchronously from rl by awaiting 'line' events.
        // Simpler approach: read up to `after` lines manually from the stream iterator.
        for (let i = 0; i < after; i++) {
          const it = await rl[Symbol.asyncIterator]().next()
          if (it.done) break
          const nextLine = it.value as string
          idx++
          ctxAfter.push(nextLine)
          bytes += Buffer.byteLength(nextLine + '\n', encoding)
        }
        matches.push({ line: idx - ctxAfter.length, text: line, groups: m.slice(1), contextBefore: ctxBefore.map((t, k) => ({ line: idx - ctxAfter.length - (ctxBefore.length - k), text: t })), contextAfter: ctxAfter.map((t, j) => ({ line: idx - ctxAfter.length + j + 1, text: t })) })
        if (matches.length >= maxMatches) break
      }
      if (bytes > opts.maxBytes) break
    }
  } finally {
    clearTimeout(timer)
    rl.close()
    stream.destroy()
  }
  return { matches, truncated: matches.length >= maxMatches || bytes > opts.maxBytes }
}

export const readLinesTool: AgentTool = {
  name: 'fs.read_lines',
  description: 'Read specific lines (head/tail/range/around) or regex matches from a UTF-8/UTF-16LE text file in the workspace',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path' },
      mode: { type: 'string', enum: ['head','tail','range','regex','around'], default: 'range' },
      headLines: { type: 'integer', minimum: 1, maximum: MAX_LINES, default: DEFAULT_LINES },
      tailLines: { type: 'integer', minimum: 1, maximum: MAX_LINES, default: DEFAULT_LINES },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
      // around
      focusLine: { type: 'integer', minimum: 1, description: 'Center line (1-based) for around-mode' },
      beforeLines: { type: 'integer', minimum: 0, maximum: MAX_LINES, default: 10 },
      afterLines: { type: 'integer', minimum: 0, maximum: MAX_LINES, default: 10 },
      window: { type: 'integer', minimum: 0, maximum: MAX_LINES, description: 'Convenience: sets beforeLines and afterLines to this value when mode=around' },
      includeLineNumbers: { type: 'boolean', default: true },
      normalizeEol: { type: 'boolean', default: true },
      maxBytes: { type: 'integer', minimum: 1024, maximum: 1048576, default: DEFAULT_MAX_BYTES },
      rejectIfBinary: { type: 'boolean', default: true },
      // regex
      pattern: { type: 'string' },
      flags: { type: 'string', description: "Only 'i' and 'm' are allowed" },
      contextBefore: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
      contextAfter: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
      maxMatches: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  run: async (input: any) => {
    try {
      const rel = String(input.path)
      const abs = resolveWithinWorkspace(rel)
      const st = await fs.stat(abs)
      if (!st.isFile()) return { ok: false, error: 'Not a file' }

      const { encoding, isBinary } = await detectEncodingAndBinary(abs)
      if (input.rejectIfBinary !== false && isBinary) return { ok: false, error: 'Binary file not supported' }

      // Normalize params
      const mode: Mode = input.mode || 'range'
      const includeNums = input.includeLineNumbers !== false
      const maxBytes = clamp(Number(input.maxBytes ?? DEFAULT_MAX_BYTES), 1024, 1024*1024)
      const timeoutMs = DEFAULT_TIMEOUT_MS

      let result: any
      if (mode === 'head') {
        const n = clamp(Number(input.headLines ?? DEFAULT_LINES), 1, MAX_LINES)
        result = await readHead(abs, encoding as BufferEncoding, n, maxBytes, timeoutMs)
        const startLine = 1
        const endLine = startLine + result.lines.length - 1
        return { ok: true, path: rel, encoding, eol: 'unknown', truncated: result.truncated, startLine, endLine, lineCount: result.lines.length, ...(includeNums ? { lines: result.lines.map((t: string, i: number) => ({ line: i+1, text: t })) } : { text: result.lines.join('\n') }) }
      }

      if (mode === 'tail') {
        const n = clamp(Number(input.tailLines ?? DEFAULT_LINES), 1, MAX_LINES)
        const r = await readTail(abs, encoding as BufferEncoding, n, maxBytes, timeoutMs)
        // Need total lines to compute start; we can approximate by returning just the lines
        return { ok: true, path: rel, encoding, eol: 'unknown', truncated: r.truncated, lineCount: r.lines.length, ...(includeNums ? { lines: r.lines.map((t: string) => ({ line: -1, text: t })) } : { text: r.lines.join('\n') }) }
      }

      if (mode === 'regex') {
        if (!input.pattern || typeof input.pattern !== 'string') return { ok: false, error: 'pattern required' }
        const r = await readRegex(abs, encoding as BufferEncoding, {
          pattern: input.pattern,
          flags: input.flags,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          maxMatches: input.maxMatches,
          maxBytes,
          timeoutMs,
          start: input.scanStartLine,
          end: input.scanEndLine,
        })
        return { ok: true, path: rel, encoding, eol: 'unknown', truncated: r.truncated, matches: r.matches }
      }

      if (mode === 'around') {
        const focus = clamp(Number(input.focusLine || 1), 1, Number.MAX_SAFE_INTEGER)
        const win = (input.window !== undefined && input.window !== null) ? clamp(Number(input.window), 0, MAX_LINES) : undefined
        let before = win !== undefined ? win : clamp(Number(input.beforeLines ?? 10), 0, MAX_LINES)
        let after = win !== undefined ? win : clamp(Number(input.afterLines ?? 10), 0, MAX_LINES)
        // ensure total window <= MAX_LINES
        let total = before + 1 + after
        if (total > MAX_LINES) {
          const over = total - MAX_LINES
          // reduce before/after proportionally, prefer reducing after first
          const reduceAfter = Math.min(after, Math.ceil(over / 2))
          after -= reduceAfter
          const reduceBefore = over - reduceAfter
          before = Math.max(0, before - reduceBefore)
          total = before + 1 + after
        }
        const start = Math.max(1, focus - before)
        const end = Math.max(start, focus + after)
        const r = await readRange(abs, encoding as BufferEncoding, start, end, maxBytes, timeoutMs)
        const startLine = start
        const endLine = start + r.lines.length - 1
        return { ok: true, path: rel, encoding, eol: 'unknown', truncated: r.truncated, startLine, endLine, lineCount: r.lines.length, ...(includeNums ? { lines: r.lines.map((t: string, i: number) => ({ line: start + i, text: t })) } : { text: r.lines.join('\n') }) }
      }

      // range (default)
      let start = Number(input.startLine || 1)
      let end = Number(input.endLine || (start + DEFAULT_LINES - 1))
      start = clamp(start, 1, Number.MAX_SAFE_INTEGER)
      end = clamp(end, start, start + MAX_LINES - 1)
      const r = await readRange(abs, encoding as BufferEncoding, start, end, maxBytes, timeoutMs)
      const startLine = start
      const endLine = start + r.lines.length - 1
      return { ok: true, path: rel, encoding, eol: 'unknown', truncated: r.truncated, startLine, endLine, lineCount: r.lines.length, ...(includeNums ? { lines: r.lines.map((t: string, i: number) => ({ line: start + i, text: t })) } : { text: r.lines.join('\n') }) }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

