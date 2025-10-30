import path from 'node:path'
import fs from 'node:fs/promises'
import fg from 'fast-glob'
import ignore from 'ignore'


let cachedNapi: any | null = null
let dynamicRegistered = false

async function loadNapi(): Promise<any> {
  if (cachedNapi) return cachedNapi
  try {
    const mod = await import('@ast-grep/napi')
    cachedNapi = mod as any
    return cachedNapi
  } catch (e: any) {
    const msg = 'Missing native dependency: @ast-grep/napi. Please install it as a production dependency so ast-grep search/rewrites can run.'
    throw new Error(msg)
  }
}

export async function verifyAstGrepAvailable(): Promise<void> {
  const napi = await loadNapi()
  try {
    if (napi?.ts?.parse) {
      const root = napi.ts.parse('const __ok = 1')
      if (!root) throw new Error('ast-grep ts parser returned null')
    } else if (typeof napi.parse === 'function') {
      const root = napi.parse('ts', 'const __ok = 1')
      if (!root) throw new Error('ast-grep generic parse returned null')
    } else {
      throw new Error('ast-grep parse API not found')
    }
  } catch (err: any) {
    throw new Error(`@ast-grep/napi failed to initialize: ${err?.message || String(err)}`)
  }
}

// Register additional languages (Python/Go/Java/etc.) at runtime if packages are installed
async function ensureDynamicLanguages(napi: any): Promise<void> {
  if (dynamicRegistered) return
  try {
    const { registerDynamicLanguage } = napi
    if (typeof registerDynamicLanguage !== 'function') { dynamicRegistered = true; return }

    // Best-effort optional imports; any missing package is simply skipped
    const regs: Record<string, any> = {}
    const tryAdd = async (name: string, pkgName: string) => {
      try {
        const m: any = await import(/* @vite-ignore */ pkgName)
        const lib = typeof m.libraryPath === 'function' ? m.libraryPath : m.libraryPath
        const extensions: string[] = Array.isArray(m.extensions) ? m.extensions : []
        if (lib && extensions.length) {
          regs[name] = {
            libraryPath: lib,
            extensions,
            languageSymbol: m.languageSymbol,
            expandoChar: m.expandoChar,
          }
        }
      } catch {}
    }

    await Promise.all([
      tryAdd('python', '@ast-grep/lang-python'),
      tryAdd('java', '@ast-grep/lang-java'),
      tryAdd('go', '@ast-grep/lang-go'),
      tryAdd('c', '@ast-grep/lang-c'),
      tryAdd('cpp', '@ast-grep/lang-cpp'),
      tryAdd('csharp', '@ast-grep/lang-csharp'),
      tryAdd('php', '@ast-grep/lang-php'),
      tryAdd('ruby', '@ast-grep/lang-ruby'),
      tryAdd('kotlin', '@ast-grep/lang-kotlin'),
      tryAdd('swift', '@ast-grep/lang-swift'),
    ])

    if (Object.keys(regs).length) {
      registerDynamicLanguage(regs)
    }
  } finally {
    dynamicRegistered = true
  }
}

function buildAvailable(napi: any): Record<string, any> {
  // Built-ins: js/ts/tsx/jsx/html/css expose .parse on napi.<name>
  const available: Record<string, any> = Object.fromEntries(
    Object.entries(napi as any).filter(([, v]) => v && typeof (v as any).parse === 'function')
  ) as any

  // Add dynamic languages registered via registerDynamicLanguage: expose a thin parse wrapper
  const dynamicNames = [
    'python','java','go','c','cpp','csharp','php','ruby','kotlin','swift'
  ]
  for (const name of dynamicNames) {
    // For dynamic langs, napi.parse(name, code) should work once registered
    available[name] = available[name] || {
      parse: (code: string) => napi.parse(name, code)
    }
  }
  return available
}

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

function extToLang(ext: string, Available: Record<string, any>): string | undefined {
  const cand = BaseExtMap[ext.toLowerCase()]
  if (cand && Available[cand]) return cand
  return undefined
}

function isSafeAstGrepPattern(input: string): boolean {
  const s = (input || '').trim()
  if (!s) return false
  if (/[\r\n]/.test(s)) return false
  if (s.includes('@')) return false
  if (s.length > 200) return false
  if (/[;,]/.test(s)) return false
  const stack: string[] = []
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[') stack.push(ch)
    else if (ch === ')') { if (stack.pop() !== '(') return false }
    else if (ch === '}') { if (stack.pop() !== '{') return false }
    else if (ch === ']') { if (stack.pop() !== '[') return false }
  }
  return stack.length === 0
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
  const { useMainStore } = await import('../store/index.js')
  const cwd = path.resolve(opts.cwd || useMainStore.getState().workspaceRoot || process.cwd())
  const include = (opts.includeGlobs && opts.includeGlobs.length ? opts.includeGlobs : ['**/*'])
  const exclude = [
    'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**',
    '.hifide-public/**', '.hifide_public/**', '.hifide-private/**', '.hifide_private/**',
    ...(opts.excludeGlobs || [])
  ]
  const maxMatches = Math.max(1, opts.maxMatches ?? 500)
  const contextLines = Math.max(0, opts.contextLines ?? 2)
  const maxFileBytes = Math.max(1, opts.maxFileBytes ?? 1_000_000)
  const concurrency = Math.max(1, Math.min(32, opts.concurrency ?? 6))
  const pattern = (opts.pattern || '').trim()
  if (!pattern) throw new Error('pattern is required')
  if (!isSafeAstGrepPattern(pattern)) {
    const durationMs = performance.now() - t0
    return { matches: [], truncated: false, stats: { scannedFiles: 0, matchedCount: 0, durationMs } }
  }

  // Discover candidate files
  const files = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })


  // .gitignore filtering (best-effort)
  try {
    const gi = await fs.readFile(path.join(cwd, '.gitignore'), 'utf-8').catch(() => '')
    if (gi) {
      const ig = ignore().add(gi)
      // Note: files are absolute; convert to workspace-relative posix for ignore check
      const filtered = files.filter(abs => !ig.ignores(path.relative(cwd, abs).replace(/\\/g, '/')))
      files.splice(0, files.length, ...filtered)
    }
  } catch {}

  const napi = await loadNapi()
  await ensureDynamicLanguages(napi)
  const Available: Record<string, any> = buildAvailable(napi)
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
      const lang = requestedLangs ? (requestedLangs.find(l => l === extToLang(ext, Available) || l === ext || l === (BaseExtMap[ext] || '')) as string | undefined) : extToLang(ext, Available)
      if (!lang || !Available[lang]) { continue }
      if (await statIsLarge(file, maxFileBytes)) { continue }
      let content = ''
      try { content = await fs.readFile(file, 'utf-8') } catch { continue }
      // Skip empty or huge after read
      if (!content) continue
      try {
        const root = (Available[lang] as any).parse(content)
        const node = typeof (root as any).root === 'function' ? (root as any).root() : root
        const found: any[] = (node && typeof (node as any).findAll === 'function') ? (node as any).findAll(pattern) || [] : []
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
  fileEditsPreview?: Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>
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
  const { useMainStore } = await import('../store/index.js')
  const cwd = path.resolve(opts.cwd || useMainStore.getState().workspaceRoot || process.cwd())

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
  // .gitignore filtering (best-effort)
  try {
    const gi = await fs.readFile(path.join(cwd, '.gitignore'), 'utf-8').catch(() => '')
    if (gi) {
      const ig = ignore().add(gi)
      const filtered = files.filter(abs => !ig.ignores(path.relative(cwd, abs).replace(/\\/g, '/')))
      files.splice(0, files.length, ...filtered)
    }
  } catch {}

  const napi = await loadNapi()
  await ensureDynamicLanguages(napi)
  const Available: Record<string, any> = buildAvailable(napi)
  const requestedLangs = opts.languages && opts.languages !== 'auto' ? opts.languages : null

  const changes: AstGrepRewriteChange[] = []
  const previews: Record<string, { before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }> = {}
  const MAX_PREVIEW = 16 * 1024 // 16 KB per file preview to keep bridge payloads small
  function clip(s?: string) {
    if (typeof s !== 'string') return s
    if (s.length > MAX_PREVIEW) return s.slice(0, MAX_PREVIEW)
    return s
  }

  let totalMatches = 0
  let changedFiles = 0
  let scanned = 0
  const queue = files.slice()

  async function worker() {
    while (totalMatches < totalLimit) {
      const file = queue.shift()
      if (!file) break
      const ext = path.extname(file).slice(1).toLowerCase()
      const lang = requestedLangs ? (requestedLangs.find(l => l === extToLang(ext, Available) || l === ext || l === (BaseExtMap[ext] || '')) as string | undefined) : extToLang(ext, Available)
      if (!lang || !Available[lang]) { continue }
      if (await statIsLarge(file, maxFileBytes)) { continue }

      let content = ''
      try { content = await fs.readFile(file, 'utf-8') } catch { continue }
      if (!content) { scanned += 1; continue }

      try {
        const root = (Available[lang] as any).parse(content)
        const node = typeof (root as any).root === 'function' ? (root as any).root() : root
        const found: any[] = (node && typeof (node as any).findAll === 'function') ? (node as any).findAll(pattern) || [] : []
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
          // Build capture-aware edits and compute proposed next via commitEdits for preview
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
              const e = typeof m.replace === 'function' ? m.replace(resolved) : null
              if (e) edits.push(e)
            } catch {}
          }

          let next: string | null = null
          try {
            // Compute proposed new content for preview; safe even in dryRun
            const committed = (found[0] as any).commitEdits ? (found[0] as any).commitEdits(edits) : (node as any).commitEdits(edits)
            if (typeof committed === 'string') next = committed
          } catch {}

          let changed = false
          if (!opts.dryRun && !opts.rangesOnly && next && next !== content) {
            try {
              await fs.writeFile(file, next, 'utf-8')
              changed = true
            } catch {}
          }

          // Preview capture (even for dryRun); include truncated flags for large content
          if (next && next !== content) {
            const rel = path.relative(cwd, file)
            const truncated = content.length > MAX_PREVIEW || next.length > MAX_PREVIEW
            previews[rel] = {
              before: clip(content),
              after: clip(next),
              sizeBefore: content.length,
              sizeAfter: next.length,
              truncated
            }
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
  const fileEditsPreview = Object.entries(previews).map(([p, v]) => ({ path: p, ...v }))
  return { changes, truncated: totalMatches >= totalLimit, stats: { scannedFiles: scanned, matchedCount: totalMatches, changedFiles, durationMs }, fileEditsPreview }
}
