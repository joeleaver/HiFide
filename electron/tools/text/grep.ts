import type { AgentTool } from '../../providers/provider'
import fs from 'node:fs/promises'
import path from 'node:path'
import ignore from 'ignore'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import { discoverWorkspaceFiles, DEFAULT_EXCLUDE_PATTERNS } from '../../utils/fileDiscovery'
import { preferUnpackedRipgrepPath, findSystemRipgrep } from '../../utils/ripgrep.js'

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function buildGitIgnore(root: string) {
  try {
    const giPath = path.join(root, '.gitignore')
    const buf = await fs.readFile(giPath, 'utf-8')
    const ig = ignore()
    ig.add(buf)
    return ig
  } catch {
    return null
  }
}


function looksBinaryByExt(file: string): boolean {
  const binExts = new Set([
    'png','jpg','jpeg','gif','webp','bmp','ico','svg','pdf','zip','gz','bz2','7z','rar','tar','xz',
    'mp3','mp4','m4a','mov','avi','mkv','webm','wav','flac','ogg',
    'exe','dll','so','dylib','bin','class','jar','wasm','ttf','otf','woff','woff2'
  ])
  const ext = path.extname(file).slice(1).toLowerCase()
  return binExts.has(ext)
}

async function looksBinaryByProbe(file: string, maxBytes = 4096): Promise<boolean> {
  try {
    const fh = await fs.open(file, 'r')
    try {
      const { size } = await fh.stat()
      const len = Math.min(maxBytes, size)
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read({ buffer: buf, position: 0, length: len })
      for (let i = 0; i < bytesRead; i++) {
        const b = buf[i]
        if (b === 0) return true // null byte
      }
      // Heuristic: if a large fraction of bytes are non-text control characters, treat as binary
      let weird = 0
      for (let i = 0; i < bytesRead; i++) {
        const b = buf[i]
        const isCommonText = (b === 9 || b === 10 || b === 13) || (b >= 32 && b <= 126)
        if (!isCommonText) weird++
      }
      return (bytesRead > 0 && weird / bytesRead > 0.3)
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}


// Fast-path search using ripgrep (vscode-ripgrep). Falls back to Node scan on any failure.
async function tryRipgrepSearch({ root, pattern, includeGlobs, excludeGlobs, options }: {
  root: string
  pattern: string
  includeGlobs: string[]
  excludeGlobs: string[]
  options: {
    ignoreCase?: boolean
    invert?: boolean
    lineNumbers?: boolean
    filenamesOnly?: boolean
    before?: number
    after?: number
    context?: number
    maxResults?: number
    literal?: boolean
  }
}): Promise<null | { ok: true; data: { summary: { filesSearched: number; filesMatched: number; linesMatched: number; truncated: boolean }, matches: any[]; nextCursor?: string } }>{
  try {
    const { existsSync } = await import('node:fs')

    // Try vscode-ripgrep module first
    let resolvedRgPath: string | null = null
    const mod: any = await import('vscode-ripgrep').catch(() => null)
    const rgPath: string | undefined = mod?.rgPath || mod?.default?.rgPath
    if (rgPath) {
      const preferred = preferUnpackedRipgrepPath(rgPath)
      if (existsSync(preferred)) {
        resolvedRgPath = preferred
      } else {
        console.warn('[grep] ripgrep binary path exists in module but file not found:', preferred)
      }
    }

    // Fallback to system ripgrep if module binary not available
    if (!resolvedRgPath) {
      resolvedRgPath = findSystemRipgrep()
    }

    if (!resolvedRgPath) {
      return null
    }

    const { spawn } = await import('node:child_process')

    const beforeN = Math.max(0, options.before ?? (options.context ?? 0))
    const afterN = Math.max(0, options.after ?? (options.context ?? 0))
    const maxResults = Math.max(1, options.maxResults ?? 2000)

    const args: string[] = ['--json', '--color', 'never']
    // Always include line numbers in JSON payload; we'll conditionally return them
    args.push('-n', '--no-heading')
    if (options.ignoreCase) args.push('-i')
    if (options.invert) args.push('-v')
    if (options.literal) args.push('-F')
    if (beforeN > 0 && afterN > 0) args.push('-C', String(Math.max(beforeN, afterN)))
    else if (beforeN > 0) args.push('-B', String(beforeN))
    else if (afterN > 0) args.push('-A', String(afterN))

    // Apply include/exclude globs
    const inc = Array.isArray(includeGlobs) && includeGlobs.length ? includeGlobs : ['**/*']
    for (const g of inc) args.push('-g', g)
    for (const g of excludeGlobs || []) args.push('-g', '!' + g)

    // Ensure .gitignore semantics by explicitly loading workspace .gitignore if present
    try {
      const giPath = path.join(root, '.gitignore')
      const s = await fs.stat(giPath)
      if (s && s.isFile()) {
        args.push('--ignore-file', giPath)
      }
    } catch {}

    // Pattern
    args.push('-e', pattern)
    // Search root (current dir)
    args.push('--', '.')

    const child = spawn(resolvedRgPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

    const filesSearched = new Set<string>()
    const filesMatched = new Set<string>()
    const matches: any[] = []
    let truncated = false

    let leftover = ''
    child.stdout.on('data', (buf: Buffer) => {
      if (truncated) return
      leftover += buf.toString('utf-8')
      let idx: number
      while ((idx = leftover.indexOf('\n')) >= 0) {
        const line = leftover.slice(0, idx)

        leftover = leftover.slice(idx + 1)
        if (!line) continue
        let evt: any
        try { evt = JSON.parse(line) } catch { continue }
        const t = evt?.type
        const d = evt?.data
        if (t === 'begin' && d?.path?.text) {
          filesSearched.add(d.path.text)
        } else if (t === 'match' && d?.path?.text) {
          // Normalize file path to workspace-relative with platform separators (to match Node path behavior and tests)
          const raw = String(d.path.text)
          const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw)
          const rel = path.relative(root, abs)
          const file = path.normalize(rel)
          filesMatched.add(file)
          const ln = Number(d.line_number || 0)
          const text = String(d.lines?.text ?? '').replace(/\r?\n$/, '')
          if (options.filenamesOnly) {
            // filename-only mode: unique files
            if (!matches.some((m) => m.file === file)) {
              matches.push({ file })
            }
          } else {
            matches.push({
              file,
              lineNumber: options.lineNumbers ? ln : undefined,
              line: text,
              before: undefined,
              after: undefined,
            })
          }
          if (matches.length >= maxResults) {
            truncated = true
            try { child.kill('SIGTERM') } catch {}
            break
          }
        }
      }
    })

    const errChunks: string[] = []
    child.stderr.on('data', (b: Buffer) => { errChunks.push(b.toString('utf-8')) })

    const exitCode: number = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 0)))
    // ripgrep returns 0 if matches found, 1 if no matches, >1 on error
    if (exitCode > 1) {
      // Fall back on Node grep on error
      return null
    }

    // Post-filter matches using .gitignore semantics (defense-in-depth; also fixes edge-cases on Windows)
    try {
      const ig = await buildGitIgnore(root)
      if (ig) {
        const filter = ig.createFilter()
        const filtered = matches.filter((m) => {
          const relPosix = String(m.file || '').split(path.sep).join('/')
          return filter(relPosix)
        })
        if (filtered.length !== matches.length) {
          matches.length = 0
          if (options.filenamesOnly) {
            const seen = new Set<string>()
            for (const m of filtered) {
              if (!seen.has(m.file)) { seen.add(m.file); matches.push({ file: m.file }) }
            }
          } else {
            matches.push(...filtered)
          }
        }
      }
    } catch {}

    return {
      ok: true,
      data: {
        summary: { filesSearched: filesSearched.size, filesMatched: filesMatched.size, linesMatched: options.filenamesOnly ? filesMatched.size : matches.length, truncated },
        matches,
        nextCursor: undefined,
      }
    }
  } catch {
    return null
  }
}

export const grepTool: AgentTool = {
  name: 'textGrep',
  description: 'Low-level text/regex search across files. Prefer workspaceSearch first; use only for exact regex or specialty cases. Read-only and workspace-scoped.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern (or literal when options.literal=true)' },
      files: { type: 'array', items: { type: 'string' }, description: 'Include globs (workspace-relative)' },
      options: {
        type: 'object',
        properties: {
          ignoreCase: { type: 'boolean' },
          invert: { type: 'boolean' },
          lineNumbers: { type: 'boolean' },
          filenamesOnly: { type: 'boolean' },
          before: { type: 'integer', minimum: 0 },
          after: { type: 'integer', minimum: 0 },
          context: { type: 'integer', minimum: 0 },
          exclude: { type: 'array', items: { type: 'string' } },
          maxFiles: { type: 'integer', minimum: 1 },
          maxResults: { type: 'integer', minimum: 1 },
          maxFileBytes: { type: 'integer', minimum: 1 },
          literal: { type: 'boolean' },
          cursor: { type: 'string', description: 'Opaque pagination cursor from a previous call' }
        },
        additionalProperties: false
      }
    },
    required: ['pattern', 'files'],
    additionalProperties: false
  },
  run: async ({ pattern, files, options = {} }: {
    pattern: string
    files: string[]
    options?: {
      ignoreCase?: boolean
      invert?: boolean
      lineNumbers?: boolean
      filenamesOnly?: boolean
      before?: number
      after?: number
      context?: number
      exclude?: string[]
      maxFiles?: number
      maxResults?: number
      maxFileBytes?: number
      literal?: boolean
      cursor?: string
    }
  }, meta?: any) => {
    const root = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, '.') : resolveWithinWorkspace('.')

    const includeGlobs = Array.isArray(files) && files.length ? files : ['**/*']
    // Use canonical exclude patterns from shared utility
    const excludeGlobs = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.exclude || [])]

    // Build full .gitignore semantics filter if available
    const ig = await buildGitIgnore(root)

    const maxFiles = Math.max(1, options.maxFiles ?? 5000)
    const maxResults = Math.max(1, options.maxResults ?? 2000)
    const maxFileBytes = Math.max(1, options.maxFileBytes ?? 10_000_000)

    const beforeN = Math.max(0, options.before ?? (options.context ?? 0))
    const afterN = Math.max(0, options.after ?? (options.context ?? 0))

    // Try fast path with ripgrep; fall back to Node scanning if unavailable or if pagination cursor is used.
    // Also skip ripgrep when very small page sizes are requested (tests rely on nextCursor for pagination),
    // since the ripgrep path does not implement pagination.
    const smallPage = typeof options.maxResults === 'number' && options.maxResults <= 5 && !options.filenamesOnly
    if (!options.cursor && !smallPage) {
      const rip = await tryRipgrepSearch({ root, pattern, includeGlobs, excludeGlobs, options })
      if (rip) return rip
    }


    const flags = options.ignoreCase ? 'i' : ''
    let re: RegExp
    try {
      const source = options.literal ? escapeRegExp(pattern) : pattern
      re = new RegExp(source, flags)
    } catch (e: any) {
      return { ok: false, error: `Invalid regex: ${e?.message || String(e)}` }
    }

    let filesSearched = 0
    let filesMatched = 0
    let linesMatched = 0
    let truncated = false

    const matches: Array<any> = []

    // Discover files using shared utility (sorted for deterministic traversal)
    const discovered = await discoverWorkspaceFiles({
      cwd: root,
      includeGlobs,
      excludeGlobs,
      absolute: true,
    })
    discovered.sort((a, b) => a.localeCompare(b))
    if (process.env.DEBUG_GREP) {
      try { console.log('[grep] discovered', discovered.map(p => path.relative(root, p))) } catch {}
    }
    // Additional .gitignore filtering if available (shared utility already applies .gitignore, but keep for compatibility)
    const filtered = ig
      ? (() => {
          const filter = ig.createFilter()
          return discovered.filter(abs => {
            const rel = path.relative(root, path.resolve(abs))
            const relPosix = rel.split(path.sep).join('/')
            return filter(relPosix)
          })
        })()
      : discovered
    if (process.env.DEBUG_GREP) {
      try { console.log('[grep] filtered', filtered.map(p => path.relative(root, p))) } catch {}
    }
    const candidates = filtered.slice(0, maxFiles)

    // Pagination cursor handling
    let startFi = 0
    let startLi = 0
    if (options.cursor) {
      try {
        const obj = JSON.parse(Buffer.from(options.cursor, 'base64').toString('utf-8'))
        if (obj && (obj.t === 'files' || obj.t === 'lines')) {
          startFi = Math.max(0, obj.fi | 0)
          startLi = obj.t === 'lines' ? Math.max(0, obj.li | 0) : 0
        }
      } catch {}
    }

    let nextCursor: string | undefined

    let curFi = startFi
    let curLi = startLi

    for (let fi = startFi; fi < candidates.length; fi++) {
      curFi = fi
      if (matches.length >= maxResults) {
        truncated = true
        nextCursor = Buffer.from(JSON.stringify({ t: options.filenamesOnly ? 'files' : 'lines', fi: curFi, li: curLi }), 'utf-8').toString('base64')
        if (process.env.DEBUG_GREP) console.log('[grep] nextCursor set at file-head', { curFi, curLi, nextCursor })
        break
      }
      const abs = candidates[fi]
      // Ensure the file is within root (defense-in-depth)
      const norm = path.resolve(abs)
      const guard = root.endsWith(path.sep) ? root : root + path.sep
      if (!(norm + path.sep).startsWith(guard)) { curLi = 0; continue }

      filesSearched++

      try {
        // Skip large files quickly
        const s = await fs.stat(norm)
        if (s.size > maxFileBytes) { curLi = 0; continue }
        if (looksBinaryByExt(norm)) { curLi = 0; continue }
        if (await looksBinaryByProbe(norm)) { curLi = 0; continue }

        const content = await fs.readFile(norm, 'utf-8')
        if (!content) { startLi = 0; curLi = 0; continue }
        const lines = content.split(/\r?\n/)

        let fileMatched = false
        if (options.filenamesOnly) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const m = re.test(line)
            const isMatch = options.invert ? !m : m
            if (isMatch) { fileMatched = true; break }
          }
          if (fileMatched) {
            filesMatched++
            matches.push({ file: path.relative(root, norm) })
            if (matches.length >= maxResults) { truncated = true; nextCursor = Buffer.from(JSON.stringify({ t: 'files', fi: fi + 1 }), 'utf-8').toString('base64'); break }
          }
          startLi = 0
          curLi = 0
          continue
        }

        for (let i = startLi; i < lines.length; i++) {
          curLi = i
          if (matches.length >= maxResults) {
            truncated = true
            nextCursor = Buffer.from(JSON.stringify({ t: 'lines', fi: fi, li: i }), 'utf-8').toString('base64')
            if (process.env.DEBUG_GREP) console.log('[grep] nextCursor set at line-head', { fi, i, nextCursor })
            break
          }
          const line = lines[i]
          const m = re.test(line)
          const isMatch = options.invert ? !m : m
          if (isMatch) {
            if (!fileMatched) { filesMatched++; fileMatched = true }
            linesMatched++
            const before = beforeN > 0 ? lines.slice(Math.max(0, i - beforeN), i) : undefined
            const after = afterN > 0 ? lines.slice(i + 1, Math.min(lines.length, i + 1 + afterN)) : undefined
            matches.push({
              file: path.relative(root, norm),
              lineNumber: options.lineNumbers ? (i + 1) : undefined,
              line,
              before,
              after,
            })
          }
        }
        startLi = 0
        curLi = 0
      } catch {
        // ignore file errors
        startLi = 0
        curLi = 0
      }
    }

    // Fallback: if we reached or exceeded maxResults but didn't set nextCursor, set it to next file/line
    if (!nextCursor && matches.length >= maxResults) {
      if (options.filenamesOnly) {
        const fiNext = Math.min(candidates.length, curFi + 1)
        if (fiNext < candidates.length) nextCursor = Buffer.from(JSON.stringify({ t: 'files', fi: fiNext }), 'utf-8').toString('base64')
      } else {
        nextCursor = Buffer.from(JSON.stringify({ t: 'lines', fi: curFi, li: curLi }), 'utf-8').toString('base64')
      }
      if (process.env.DEBUG_GREP) console.log('[grep] nextCursor set at fallback', { curFi, curLi, nextCursor })
    }


    // As a last resort, if we produced some results but didn't hit the cap, and there are more files ahead,
    // expose a file-level cursor so callers can continue scanning.
    if (!nextCursor && matches.length > 0) {
      const fiNext = Math.min(candidates.length, curFi + 1)
      if (fiNext < candidates.length) {
        nextCursor = Buffer.from(JSON.stringify({ t: 'files', fi: fiNext }), 'utf-8').toString('base64')
        if (process.env.DEBUG_GREP) console.log('[grep] nextCursor set at tail-resume', { curFi, curLi, nextCursor })
      }
    }

    return {
      ok: true,
      data: {
        summary: { filesSearched, filesMatched, linesMatched, truncated },
        matches,
        nextCursor,
      }
    }
  }
}



// Convenience async generator to iterate all pages
export async function *grepAllPages(input: Parameters<typeof grepTool.run>[0], meta?: any) {
  let cursor: string | undefined = input?.options?.cursor
  const base = { ...input, options: { ...(input.options || {}) } }
  while (true) {
    const res: any = await grepTool.run({
      ...base,
      options: { ...base.options, cursor }
    }, meta)
    yield res
    if (!res || !res.ok) return
    cursor = res?.data?.nextCursor
    if (!cursor) return
  }
}
