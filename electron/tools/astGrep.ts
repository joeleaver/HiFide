import path from 'node:path'
import fs from 'node:fs/promises'
import fg from 'fast-glob'
import * as napi from '@ast-grep/napi'

export type AstGrepSearchOptions = {
  pattern: string
  languages?: string[] | 'auto'
  includeGlobs?: string[]
  excludeGlobs?: string[]
  maxMatches?: number
  contextLines?: number
  maxFileBytes?: number
  concurrency?: number
  cwd?: string
}

export type AstGrepMatch = {
  filePath: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  snippet: string
  text: string
}

export type AstGrepSearchResult = {
  matches: AstGrepMatch[]
  truncated: boolean
  stats: { scannedFiles: number; matchedCount: number; durationMs: number }
}

// Detect available languages from @ast-grep/napi dynamically
const Available: Record<string, any> = Object.fromEntries(
  Object.entries(napi as any).filter(([, v]) => v && typeof (v as any).parse === 'function')
) as any

// Conservative extension mapping. We only enable entries that exist in Available at runtime.
const BaseExtMap: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  py: 'python', pyw: 'python',
  dart: 'dart',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  scala: 'scala',
  zig: 'zig',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  rsx: 'rust',
  lua: 'lua',
  ml: 'ocaml', mli: 'ocaml',
  hs: 'haskell',
  sh: 'bash', bash: 'bash', zsh: 'bash'
}

function extToLang(ext: string): string | undefined {
  const cand = BaseExtMap[ext.toLowerCase()]
  if (cand && Available[cand]) return cand
  return undefined
}

function linesAround(content: string, startLine1: number, endLine1: number, context: number): string {
  const lines = content.split(/\r?\n/)
  const from = Math.max(1, startLine1 - context)
  const to = Math.min(lines.length, endLine1 + context)
  return lines.slice(from - 1, to).join('\n')
}

async function statIsLarge(filePath: string, maxBytes: number): Promise<boolean> {
  try {
    const st = await fs.stat(filePath)
    return st.size > maxBytes
  } catch { return false }
}

export async function astGrepSearch(opts: AstGrepSearchOptions): Promise<AstGrepSearchResult> {
  const t0 = performance.now()
  const cwd = path.resolve(opts.cwd || process.env.APP_ROOT || process.cwd())
  const include = (opts.includeGlobs && opts.includeGlobs.length ? opts.includeGlobs : ['**/*'])
  const exclude = [
    'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**',
    ...(opts.excludeGlobs || [])
  ]
  const maxMatches = Math.max(1, opts.maxMatches ?? 500)
  const contextLines = Math.max(0, opts.contextLines ?? 2)
  const maxFileBytes = Math.max(1, opts.maxFileBytes ?? 1_000_000)
  const concurrency = Math.max(1, Math.min(32, opts.concurrency ?? 6))
  const pattern = (opts.pattern || '').trim()
  if (!pattern) throw new Error('pattern is required')

  // Discover candidate files
  const files = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })

  const requestedLangs = opts.languages && opts.languages !== 'auto' ? opts.languages : null

  const matches: AstGrepMatch[] = []
  let scanned = 0

  // Simple promise pool for concurrency control
  const queue = files.slice()
  async function worker() {
    while (matches.length < maxMatches) {
      const file = queue.shift()
      if (!file) break
      const ext = path.extname(file).slice(1).toLowerCase()
      const lang = requestedLangs ? (requestedLangs.find(l => l === extToLang(ext) || l === ext || l === (BaseExtMap[ext] || '')) as string | undefined) : extToLang(ext)
      if (!lang || !Available[lang]) { continue }
      if (await statIsLarge(file, maxFileBytes)) { continue }
      let content = ''
      try { content = await fs.readFile(file, 'utf-8') } catch { continue }
      // Skip empty or huge after read
      if (!content) continue
      try {
        const root = (Available[lang] as any).parse(content)
        const rule = { pattern }
        const found: any[] = root.findAll(rule) || []
        for (const m of found) {
          if (matches.length >= maxMatches) break
          const r = m.range?.() || m.range || { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }
          const startLine1 = (r.start?.row ?? 0) + 1
          const startCol1 = (r.start?.column ?? 0) + 1
          const endLine1 = (r.end?.row ?? startLine1 - 1) + 1
          const endCol1 = (r.end?.column ?? 0) + 1
          const snippet = linesAround(content, startLine1, endLine1, contextLines)
          const text = typeof m.text === 'function' ? m.text() : (m.getText ? m.getText() : '')
          matches.push({ filePath: path.relative(cwd, file), startLine: startLine1, startCol: startCol1, endLine: endLine1, endCol: endCol1, snippet, text })
        }
      } catch {
        // ignore parse errors for unsupported edge cases
      } finally {
        scanned += 1
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  await Promise.all(workers)

  const durationMs = performance.now() - t0
  return { matches, truncated: matches.length >= maxMatches, stats: { scannedFiles: scanned, matchedCount: matches.length, durationMs } }
}



export type AstGrepRewriteOptions = {
  pattern: string
  rewrite: string
  languages?: string[] | 'auto'
  includeGlobs?: string[]
  excludeGlobs?: string[]
  perFileLimit?: number
  totalLimit?: number
  maxFileBytes?: number
  concurrency?: number
  cwd?: string
  dryRun?: boolean
  rangesOnly?: boolean
}

export type AstGrepRewriteChange = {
  filePath: string
  ranges: { startLine: number; startCol: number; endLine: number; endCol: number }[]
  count: number
  applied: boolean
}

export type AstGrepRewriteResult = {
  changes: AstGrepRewriteChange[]
  truncated: boolean
  stats: { scannedFiles: number; matchedCount: number; changedFiles: number; durationMs: number }
}

function toOffsetIndex(lines: string[]): number[] {
  const idx: number[] = [0]
  for (let i = 0; i < lines.length; i++) idx.push(idx[i] + lines[i].length + 1)
  return idx
}

function lcToOffset(lineIdx: number[], line1: number, col1: number): number {
  const line0 = Math.max(0, Math.min(lineIdx.length - 2, (line1 | 0) - 1))
  const base = lineIdx[line0]
  return base + Math.max(0, (col1 | 0) - 1)
}

export async function astGrepRewrite(opts: AstGrepRewriteOptions): Promise<AstGrepRewriteResult> {
  const t0 = performance.now()
  const cwd = path.resolve(opts.cwd || process.env.APP_ROOT || process.cwd())
  const include = (opts.includeGlobs && opts.includeGlobs.length ? opts.includeGlobs : ['**/*'])
  const exclude = [ 'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**', ...(opts.excludeGlobs || []) ]
  const maxFileBytes = Math.max(1, opts.maxFileBytes ?? 1_000_000)
  const concurrency = Math.max(1, Math.min(32, opts.concurrency ?? 6))
  const perFileLimit = Math.max(1, opts.perFileLimit ?? 100)
  const totalLimit = Math.max(1, opts.totalLimit ?? 1000)
  const pattern = (opts.pattern || '').trim()
  const rewrite = (opts.rewrite ?? '')
  if (!pattern) throw new Error('pattern is required')

  const files = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })
  const requestedLangs = opts.languages && opts.languages !== 'auto' ? opts.languages : null

  const changes: AstGrepRewriteChange[] = []
  let totalMatches = 0
  let changedFiles = 0
  let scanned = 0
  const queue = files.slice()

  async function worker() {
    while (totalMatches < totalLimit) {
      const file = queue.shift()
      if (!file) break
      const ext = path.extname(file).slice(1).toLowerCase()
      const lang = requestedLangs ? (requestedLangs.find(l => l === extToLang(ext) || l === ext || l === (BaseExtMap[ext] || '')) as string | undefined) : extToLang(ext)
      if (!lang || !Available[lang]) { continue }
      if (await statIsLarge(file, maxFileBytes)) { continue }

      let content = ''
      try { content = await fs.readFile(file, 'utf-8') } catch { continue }
      if (!content) { scanned += 1; continue }

      try {
        const root = (Available[lang] as any).parse(content)
        const rule = { pattern }
        const found: any[] = root.findAll(rule) || []
        const ranges: { s: number; e: number; startLine: number; startCol: number; endLine: number; endCol: number }[] = []
        const lineIdx = toOffsetIndex(content.split(/\r?\n/))
        for (const m of found) {
          if (totalMatches >= totalLimit || ranges.length >= perFileLimit) break
          const r = m.range?.() || m.range || { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }
          const startLine1 = (r.start?.row ?? 0) + 1
          const startCol1 = (r.start?.column ?? 0) + 1
          const endLine1 = (r.end?.row ?? startLine1 - 1) + 1
          const endCol1 = (r.end?.column ?? 0) + 1
          const s = lcToOffset(lineIdx, startLine1, startCol1)
          const e = lcToOffset(lineIdx, endLine1, endCol1)
          ranges.push({ s, e, startLine: startLine1, startCol: startCol1, endLine: endLine1, endCol: endCol1 })
        }

        if (ranges.length) {
          // Build capture-aware edits and optionally apply via commitEdits
          const edits: any[] = []
          const resultRanges = ranges.map(r => ({ startLine: r.startLine, startCol: r.startCol, endLine: r.endLine, endCol: r.endCol }))
          for (const m of found.slice(0, ranges.length)) {
            // Resolve rewrite template using captures like $VAR and $MATCH
            let resolved = rewrite
            const tokens = Array.from(new Set((rewrite.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) || [])))
            for (const t of tokens) {
              if (t === '$MATCH') {
                resolved = resolved.split(t).join(typeof m.text === 'function' ? m.text() : (m.getText ? m.getText() : ''))
                continue
              }
              const name = t.slice(1)
              try {
                const cap = typeof m.getMatch === 'function' ? m.getMatch(name) : null
                const rep = cap && typeof cap.text === 'function' ? cap.text() : ''
                if (rep) resolved = resolved.split(t).join(rep)
              } catch {}
            }
            try {
              if (!opts.dryRun && !opts.rangesOnly) {
                const e = typeof m.replace === 'function' ? m.replace(resolved) : null
                if (e) edits.push(e)
              }
            } catch {}
          }

          let changed = false
          if (!opts.dryRun && !opts.rangesOnly && edits.length) {
            try {
              const next = (found[0] as any).commitEdits ? (found[0] as any).commitEdits(edits) : (root as any).commitEdits(edits)
              if (typeof next === 'string' && next !== content) {
                await fs.writeFile(file, next, 'utf-8')
                changed = true
              }
            } catch {}
          }

          totalMatches += ranges.length
          changedFiles += changed ? 1 : 0
          changes.push({ filePath: path.relative(cwd, file), ranges: resultRanges, count: ranges.length, applied: changed })
        }
      } catch {
        // ignore parse/other errors and move on
      } finally {
        scanned += 1
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  await Promise.all(workers)

  const durationMs = performance.now() - t0
  return { changes, truncated: totalMatches >= totalLimit, stats: { scannedFiles: scanned, matchedCount: totalMatches, changedFiles, durationMs } }
}
