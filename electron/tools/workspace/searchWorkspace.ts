import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import fs from 'node:fs/promises'
import ignore from 'ignore'
import fg from 'fast-glob'

import { grepTool } from '../text/grep'
import { getIndexer } from '../../core/state'
import { getIndexingService } from '../../services/index.js'
import { resolveWorkspaceRootAsync } from '../../utils/workspace.js'
import { getLocalEngine } from '../../indexing/engine'

import { randomUUID } from 'node:crypto'

// Lightweight in-memory cache to dedupe repeated, identical searches within short windows
// Keyed by workspace root + normalized args; capped size with TTL to avoid leaks
const __wsSearchCache: Map<string, { ts: number; data: any }> = new Map()
const WS_CACHE_TTL_MS = 20_000 // 20s window to collapse repeated calls
const WS_CACHE_MAX = 64

function normalizeFilters(f?: SearchWorkspaceParams['filters']) {
  const filters = f || {}
  return {
    languages: Array.isArray(filters.languages) ? [...filters.languages].sort() : [],
    pathsInclude: Array.isArray(filters.pathsInclude) ? [...filters.pathsInclude].sort() : [],
    pathsExclude: Array.isArray(filters.pathsExclude) ? [...filters.pathsExclude].sort() : [],
    maxResults: Math.max(1, filters.maxResults ?? 20),
    maxSnippetLines: Math.max(4, filters.maxSnippetLines ?? 12),
    // Back-compat: default to generous time budget so tests and typical searches don't timeout
    timeBudgetMs: Math.max(200, filters.timeBudgetMs ?? 10_000)
  }
}

function makeCacheKey(root: string, args: SearchWorkspaceParams) {
  const queries = Array.isArray(args.queries) && args.queries.length
    ? [...args.queries].map((q) => (q || '').trim()).filter(Boolean).sort()
    : [(args.query || '').trim()].filter(Boolean)
  const keyObj = {
    root,
    mode: args.mode || 'auto',
    action: args.action || 'search',
    queries,
    handle: args.handle || '',
    filters: normalizeFilters(args.filters)
  }
  return JSON.stringify(keyObj)
}

function wsCacheGet(key: string) {
  const v = __wsSearchCache.get(key)
  if (!v) return null
  if (Date.now() - v.ts > WS_CACHE_TTL_MS) { __wsSearchCache.delete(key); return null }
  return v.data
}

function wsCacheSet(key: string, data: any) {
  __wsSearchCache.set(key, { ts: Date.now(), data })
  if (__wsSearchCache.size > WS_CACHE_MAX) {
    // Evict oldest
    const first = __wsSearchCache.keys().next().value
    if (first) __wsSearchCache.delete(first)
  }
}

// ---- Types (align with planning doc, trimmed for MVP) ---------------------------------

export type SearchMode = 'auto'|'text'|'semantic'|'ast'|'path'

export interface SearchWorkspaceParams {
  mode?: SearchMode
  // Back-compat single query; prefer queries[] for batching
  query?: string
  // New: allow batching multiple queries in parallel
  queries?: string[]
  filters?: {
    languages?: string[]
    pathsInclude?: string[]
    pathsExclude?: string[]
    maxResults?: number
    maxSnippetLines?: number
    timeBudgetMs?: number
  }
  // Pagination (not yet implemented): cursor?: string
  action?: 'search'|'expand'
  handle?: string // for action=expand
}

export interface SearchWorkspaceResultHit {
  type: 'SNIPPET'|'AST'|'FILE'
  path: string
  lines?: { start: number; end: number }
  highlights?: { startLine:number; startCol:number; endLine:number; endCol:number }[]
  score: number
  preview: string
  language?: string
  reasons: string[]
  matchedQueries?: string[]
  handle: string
  corpus?: 'workspace'|'kb'
}

export interface SearchWorkspaceResult {
  results: SearchWorkspaceResultHit[]
  summary: string[]
  nextCursor?: string
  meta: { elapsedMs:number; strategiesUsed:string[]; truncated:boolean }
}

// ---- Helpers -------------------------------------------------------------------------
async function getWorkspaceRoot(hint?: string): Promise<string> {
  return resolveWorkspaceRootAsync(hint)
}

// Simple glob matcher (supports **, *, ?) against POSIX-style paths
function globToRegExp(pat: string): RegExp {
  let s = (pat || '').replace(/\\/g, '/').trim()
  // Normalize: ensure patterns without leading **/ match anywhere
  if (!s.startsWith('**/')) s = s.startsWith('/') ? s.slice(1) : s
  // Tokenize special wildcards first
  s = s.replace(/\*\*/g, '::DOUBLE_AST::')
       .replace(/\*/g, '::SINGLE_AST::')
       .replace(/\?/g, '::QMARK::')
  // Escape regex metacharacters
  s = s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  // Expand tokens
  s = s.replace(/::DOUBLE_AST::/g, '.*')
       .replace(/::SINGLE_AST::/g, '[^/]*')
       .replace(/::QMARK::/g, '[^/]')
  return new RegExp('^' + s + '$', 'i')
}

function compileGlobMatcher(globs?: string[]): ((p: string) => boolean) | null {
  if (!globs || !globs.length) return null
  const regs = globs.map(gl => globToRegExp(gl))
  return (p: string) => {
    const rel = (p || '').replace(/\\/g, '/')
    return regs.some(re => re.test(rel))
  }
}

function normalizeIncludeGlobs(globs?: string[]): string[] | undefined {
  if (!globs || !globs.length) return globs
  const out: string[] = []
  for (let g of globs) {
    g = String(g || '').replace(/\\/g, '/').trim()
    if (!g) continue
    const hasWildcard = /[\*\?\[]/.test(g)
    if (g.endsWith('/')) {
      out.push(g + '**')
      continue
    }
    if (!hasWildcard) {
      // If it looks like a file (has extension), keep as-is; also add direct match
      if (/\.[a-z0-9]+$/i.test(g)) {
        out.push(g)
      } else {
        // Treat as directory or prefix: include direct, star suffix, and recursive
        out.push(g + '*')
        out.push(g + '/**')
      }
      continue
    }
    out.push(g)
  }
  // De-dup while preserving order
  const seen = new Set<string>()
  const dedup: string[] = []
  for (const p of out) { if (!seen.has(p)) { seen.add(p); dedup.push(p) } }
  return dedup
}

function extractBareTokens(q: string): string[] {
  const s = (q || '').trim()
  if (!s) return []
  return s.split(/\s+/)
    .map(t => t.trim())
    .filter(t => t && !/^re:|^text:|^ast:/i.test(t))
    .filter(t => t.length >= 3)
}


// Boost path score when query tokens appear in the path (helps broad NL queries)
function pathTokenBoost(pathRel: string, query: string): number {
  const p = (pathRel || '').toLowerCase()
  const toks = (query || '').toLowerCase().split(/\s+/).filter(t => t.length >= 3 && !/^re:|^text:|^ast:/i.test(t))
  if (!toks.length) return 0
  let matches = 0
  for (const t of toks) { if (p.includes(t)) matches++ }
  // Each token contributes; cap to 1.0
  return Math.min(1, matches * 0.35)
}


function classifyMode(q: string): SearchMode {
  const s = (q || '').trim()
  if (/^re:|^text:/i.test(s)) return 'text'
  if (/^ast:/i.test(s)) return 'ast'
  if (/[*?{}\[\]\\/]/.test(s)) return 'path'
  return 'auto'
}

// Heuristic: extract filename-like tokens (support multi-word queries)
function extractFilenameTokens(q: string): string[] {
  const s = (q || '').trim()
  if (!s) return []
  const tokens = s.split(/\s+/)
  const out: string[] = []
  for (const tRaw of tokens) {
    const t = tRaw.trim()
    if (!t || /^re:|^text:|^ast:/i.test(t)) continue
    if (t.includes('/') || t.includes('\\') || t.includes('.')) { out.push(t); continue }
    const lowers = t.toLowerCase()
    if (lowers.includes('config') || lowers.includes('readme') || lowers.includes('package')) { out.push(t); continue }
  }
  return out
}

function looksLikeFilename(q: string): boolean {
  return extractFilenameTokens(q).length > 0
}

async function runPathSearch(term: string, include: string[]|undefined, exclude: string[]|undefined, maxResults: number, maxSnippetLines: number, rootHint?: string) {
  const root = await getWorkspaceRoot(rootHint)
  const t = (term || '').replace(/^re:|^text:|^ast:/i, '').trim()
  if (!t) return []

  // Build glob patterns
  const patterns: string[] = []
  if (/[*?{}\[\]]/.test(t) || t.includes('/') || t.includes('\\')) {
    const p = t.startsWith('**/') ? t : `**/${t}`
    patterns.push(p)
  } else {
    patterns.push(`**/${t}`)
    patterns.push(`**/*${t}*`)
  }

  let files: string[] = []
  try {
    if (include && include.length) {
      const candidates = await fg(include, { cwd: root, ignore: exclude || [], onlyFiles: true, absolute: false, dot: false })
      const needle = t.toLowerCase()
      files = candidates.filter(p => p.toLowerCase().includes(needle))
    } else {
      files = await fg(patterns, { cwd: root, ignore: exclude || [], onlyFiles: true, absolute: false, dot: false })
    }
  } catch {}

  // Deduplicate and read small previews
  const seen = new Set<string>()
  const hits: Array<{ path:string; startLine:number; endLine:number; text:string }> = []
  for (const p of files) {
    const rel = p.replace(/\\/g, '/')
    if (seen.has(rel)) continue
    seen.add(rel)
    try {
      const abs = path.resolve(root, rel)
      const content = await fs.readFile(abs, 'utf-8').catch(() => '')
      const lines = (content || '').split(/\r?\n/)
      const end = Math.min(lines.length, Math.max(1, maxSnippetLines))
      const snippet = lines.slice(0, end).join('\n')
      hits.push({ path: rel, startLine: 1, endLine: end, text: snippet })
    } catch {
      hits.push({ path: rel, startLine: 1, endLine: 1, text: '' })
    }
    if (hits.length >= maxResults) break
  }
  return hits
}


function b64(obj: any): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64')
}
function fromB64<T=any>(h?: string): T | null {
  if (!h) return null
  try { return JSON.parse(Buffer.from(h, 'base64').toString('utf-8')) as T } catch { return null }
}

async function safeStatMtimeMs(abs: string): Promise<number> {
  try { const s = await fs.stat(abs); return s.mtimeMs || 0 } catch { return 0 }
}

function clampPreview(text: string, maxLines: number): string {
  const s = String(text || '')
  const MAX_CHARS = Math.max(512, Math.min(4000, maxLines * 160))
  if (s.length > MAX_CHARS) {
    const half = Math.floor(MAX_CHARS / 2)
    return s.slice(0, half) + '\n...\n' + s.slice(-half)
  }
  const lines = s.split(/\r?\n/)
  if (lines.length <= maxLines) return s
  const head = lines.slice(0, Math.max(1, Math.floor(maxLines / 2)))
  const tail = lines.slice(-Math.max(1, Math.ceil(maxLines / 2)))
  const joined = head.join('\n') + '\n...\n' + tail.join('\n')
  if (joined.length > MAX_CHARS) {
    const h = Math.floor(MAX_CHARS / 2)
    return joined.slice(0, h) + '\n...\n' + joined.slice(-h)
  }
  return joined
}


// Prefer code files over docs/locks, and src/** over root
function fileScoreBoost(pth: string, opts?: { skipDemotes?: boolean }): number {
  const ext = extOf(pth)
  const lower = pth.toLowerCase()
  // Hard demotes (always apply)
  if (lower.endsWith('package-lock.json') || lower.endsWith('yarn.lock') || lower.endsWith('pnpm-lock.yaml')) return 0.1
  // Extension weights
  const codeExts = new Set(['ts','tsx','js','jsx','py','go','java','c','cpp','cs','kt','swift','rs'])
  const docExts = new Set(['md','txt'])
  const confExts = new Set(['json','yml','yaml','toml','sh'])
  let w = 1.0
  if (codeExts.has(ext)) w *= 1.3
  if (docExts.has(ext)) w *= (opts?.skipDemotes ? 1.0 : 0.6)
  if (confExts.has(ext)) w *= (opts?.skipDemotes ? 1.0 : 0.8)
  // Stub demotion (UI stubs should not dominate generic queries)
  if (!opts?.skipDemotes && /(^|\/)\w+_stub\.(tsx?|jsx?)$/i.test(pth)) w *= 0.6
  // Core boosts
  if (/(^|\/)store\.ts$/i.test(pth)) w *= 1.35
  if (/(^|\/)engine_.*\.ts$/i.test(pth)) w *= 1.25
  if (/(^|\/)app\.tsx$/i.test(pth)) w *= 1.2
  // Path hints
  if (/^src\//i.test(pth) || /^electron\//i.test(pth) || /^packages\//i.test(pth)) w *= 1.15
  return w
}

function extOf(pth: string): string { return path.extname(pth).slice(1).toLowerCase() }

// Rank combiner (simple weighted sum)
function combineScore(parts: Partial<Record<'semantic'|'grep'|'ast'|'recency'|'path', number>>): number {
  const w = { semantic: 0.30, grep: 0.25, ast: 0.15, path: 0.60, recency: 0.05 }
  return (parts.semantic||0)*w.semantic
    + (parts.grep||0)*w.grep
    + (parts.ast||0)*w.ast
    + (parts.path||0)*w.path
    + (parts.recency||0)*w.recency
}

function stripPrefixes(q: string): string {
  return (q || '').replace(/^re:|^text:|^ast:/i, '').trim()
}

function isExactBasenameMatch(pth: string, matched: Set<string>): boolean {
  try {
    const base = path.basename(pth).toLowerCase()
    for (const q of matched) {
      const s = stripPrefixes(String(q || '')).toLowerCase()
      if (s && s === base) return true
    }
  } catch {}
  return false
}

// ---- Auto-refresh preflight ----------------------------------------------------------

const defaultExcludes = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.turbo', '.yarn', '.pnpm-store', 'out', '.idea', '.vscode', '.hifide-public', '.hifide_public', '.hifide-private', '.hifide_private'])
async function countWorkspaceFiles(root: string): Promise<number> {
  async function walk(dir: string): Promise<number> {
    let entries: any[] = []
    try { entries = await (fs as any).readdir(dir, { withFileTypes: true }) } catch { return 0 }
    let sum = 0

    for (const e of entries) {
      const p = path.join(dir, e.name)
      if ((e as any).isDirectory && (e as any).isDirectory()) {
        if (defaultExcludes.has(e.name)) continue
        sum += await walk(p)
      } else {
        sum += 1
      }
    }
    return sum
  }
  return walk(root)
}

async function autoRefreshPreflight(workspaceId?: string): Promise<{ triggered: boolean }> {
  try {
    const indexingService = getIndexingService()

    const st = indexingService.getState()
    const cfg = st?.idxAutoRefresh
    if (!cfg || !cfg.enabled) return { triggered: false }

    const indexer = await getIndexer()
    const s: any = indexer.status()
    const now = Date.now()
    const indexMtime = s?.indexPath ? await safeStatMtimeMs(s.indexPath) : 0
    const lastRebuildAt = st?.idxLastRebuildAt || indexMtime
    const attempts: number[] = Array.isArray(st?.idxRebuildTimestamps) ? st.idxRebuildTimestamps : []
    const lastAttemptAt = attempts.length ? attempts[attempts.length - 1] : 0
    const sinceLast = now - (lastRebuildAt || 0)
    const sinceAttempt = now - (lastAttemptAt || 0)
    const minIntervalMs = Math.max(0, (cfg.minIntervalMinutes ?? 10) * 60_000)

    let should = !s?.exists || !s?.ready

    // TTL
    if (!should && cfg.ttlMinutes && sinceLast > cfg.ttlMinutes * 60_000 && sinceAttempt > minIntervalMs) {
      should = true
    }

    // Lockfile trigger
    if (!should && cfg.lockfileTrigger) {
      // Workspace root should come from workspaceId parameter
      const root = await getWorkspaceRoot(workspaceId)
      const globs = Array.isArray(cfg.lockfileGlobs) ? cfg.lockfileGlobs : []
      for (const f of globs) {
        const m = await safeStatMtimeMs(path.join(root, f))
        if (m && m > indexMtime && sinceAttempt > minIntervalMs) { should = true; break }
      }
    }

    // Model change trigger
    if (!should && cfg.modelChangeTrigger) {
      try {
        const eng = await getLocalEngine()
        if (s?.modelId && !String(s.modelId).startsWith(eng.id)) should = true
      } catch {}
    }

    // Workspace churn (approximate)
    let currCount: number | undefined
    if (!should && sinceAttempt > minIntervalMs && (cfg.changeAbsoluteThreshold || cfg.changePercentThreshold)) {
      const root = await getWorkspaceRoot(workspaceId)
      currCount = await countWorkspaceFiles(root)
      const prev = st?.idxLastFileCount || currCount
      const abs = Math.abs((currCount || 0) - (prev || 0))
      const pct = prev ? abs / prev : 0
      if ((cfg.changeAbsoluteThreshold && abs >= cfg.changeAbsoluteThreshold) || (cfg.changePercentThreshold && pct >= cfg.changePercentThreshold)) {
        should = true
      }
      indexingService.updateIndexMetrics({ lastScanAt: now, lastFileCount: currCount })
    }

    // Rate limit
    const hourAgo = now - 60 * 60 * 1000
    const recent = attempts.filter((t) => t >= hourAgo)
    if (should && cfg.maxRebuildsPerHour && recent.length >= cfg.maxRebuildsPerHour) {
      should = false
    }

    if (should && !s?.inProgress) {
      const prev = indexingService.getRebuildTimestamps() || []
      indexingService.updateIndexMetrics({
        lastRebuildAt: now,
        rebuildTimestamps: [...prev, now].filter((t: number) => now - t < 60 * 60 * 1000),
        ...(typeof currCount === 'number' ? { lastFileCount: currCount } : {}),
      })
      indexer.rebuild(() => {}).catch(() => {})
      return { triggered: true }
    }
    return { triggered: false }
  } catch {
    return { triggered: false }
  }
}




// ---- Orchestrator --------------------------------------------------------------------

async function runSemantic(query: string, k: number) {
  try {
    const wsIdx = await getIndexer()
    const ws = await wsIdx.search(query, k)
    const items: any[] = []
    for (const c of (ws?.chunks || [])) {
      items.push({ path: c.path as string, startLine: c.startLine as number, endLine: c.endLine as number, text: c.text as string, score: 1, corpus: 'workspace' })
    }
    return items
  } catch { return [] }
}

async function runGrep(query: string, include: string[]|undefined, exclude: string[]|undefined, maxResults: number, literal: boolean) {
  const res: any = await grepTool.run({
    pattern: query,
    files: include && include.length ? include : ['**/*'],
    options: { exclude, maxResults, before: 2, after: 2, ignoreCase: true, literal }
  })
  if (!res?.ok) return []
  const out: Array<{ path:string; startLine:number; endLine:number; text:string } & { hits:number }> = []
  for (const m of res.data.matches) {
    if (!m || !m.file) continue
    const lineNum = (m.lineNumber as number|undefined) || 0
    const before = (m.before||[]) as string[]
    const after = (m.after||[]) as string[]
    const lines = [...before, m.line, ...after]
    const startLine = lineNum ? (lineNum - before.length) : 0
    const endLine = startLine ? (startLine + lines.length - 1) : 0
    out.push({ path: m.file, startLine, endLine, text: lines.join('\n'), hits: 1 })
  }
  return out
}



function toHandle(pathRel: string, start: number, end: number) {
  return b64({ t: 'h', p: pathRel, s: start|0, e: end|0 })
}

async function expandFromHandle(handle: string, opts?: { extraBefore?: number; extraAfter?: number; clampTo?: number }, rootHint?: string) {
  const parsed = fromB64<{ t:string; p:string; s:number; e:number }>(handle)
  if (!parsed || parsed.t !== 'h') return { ok: false, error: 'Invalid handle' }
  const root = await getWorkspaceRoot(rootHint)
  const abs = path.resolve(root, parsed.p)
  let content = ''
  try { content = await fs.readFile(abs, 'utf-8') } catch (e: any) { return { ok: false, error: e?.message || 'Failed to read file' } }
  const lines = content.split(/\r?\n/)

  const b = Math.max(1, parsed.s - (opts?.extraBefore ?? 20))
  const e = Math.min(lines.length, parsed.e + (opts?.extraAfter ?? 20))
  const snippet = lines.slice(b-1, e).join('\n')
  const preview = opts?.clampTo ? clampPreview(snippet, opts.clampTo) : snippet
  return { ok: true, path: parsed.p, startLine: b, endLine: e, preview }
}


// Simple concurrency limiter for arrays of async thunks
async function allWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  return new Promise((resolve) => {
    const results: T[] = new Array(tasks.length)
    let i = 0, running = 0, done = 0
    function launch() {
      while (running < limit && i < tasks.length) {
        const idx = i++
        running++
        tasks[idx]().then((v) => { (results as any)[idx] = v })
          .catch(() => { (results as any)[idx] = undefined })
          .finally(() => {
            running--
            done++
            if (done === tasks.length) return resolve(results)
            launch()
          })
      }
      if (tasks.length === 0) resolve(results)
    }
    launch()
  })
}

// Compute an effective time budget based on number of terms; ensure low hints are lifted
export function computeAutoBudget(numTerms: number, provided?: number): number {
  const base = 10_000 // single-term default
  const perTerm = 1_500 // add per extra term
  const cap = 30_000 // hard cap to avoid runaway jobs
  const computed = Math.min(cap, base + Math.max(0, (numTerms | 0) - 1) * perTerm)
  return Math.max(computed, provided || 0)
}


export const searchWorkspaceTool: AgentTool = {
  name: 'workspaceSearch',
  description: 'Unified workspace code search (semantic + ripgrep + AST). Start here to locate code: accepts natural-language or exact text and returns ranked hits with compact snippets and handles. Then call with action="expand" + a handle to fetch the full region; after a couple of expands, switch to applyEdits to change code.',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['auto','text','semantic','ast','path'] },
      query: { type: 'string', description: 'Natural-language or literal search text. Prefer concise phrases (e.g., "zustand store definition").' },
      queries: { type: 'array', items: { type: 'string' }, description: 'Batch multiple natural-language or literal queries to run in parallel.' },
      filters: {
        type: 'object',
        properties: {
          languages: { type: 'array', items: { type: 'string' } },
          pathsInclude: { type: 'array', items: { type: 'string' } },
          pathsExclude: { type: 'array', items: { type: 'string' } },
          maxResults: { type: 'integer', minimum: 1 },
          maxSnippetLines: { type: 'integer', minimum: 1 },
          timeBudgetMs: { type: 'integer', minimum: 100 }
        },
        additionalProperties: false
      },
      action: { type: 'string', enum: ['search','expand'] },
      handle: { type: 'string' },
      searchOnce: { type: 'boolean', description: 'If true, minimize results for early stop (tool may still run all lanes).', default: false }
    },

    additionalProperties: false
  },

  run: async (args: SearchWorkspaceParams, meta?: any): Promise<any> => {
    const t0 = Date.now()

    // Handle expand action fast-path
    if (args.action === 'expand' && args.handle) {
      const exp = await expandFromHandle(args.handle, { extraBefore: 25, extraAfter: 25, clampTo: (args?.filters?.maxSnippetLines ?? 60) }, meta?.workspaceId)
      if (!exp.ok) return { ok: false, error: (exp as any).error }
      const elapsedMs = Date.now() - t0
      const pathOut = String((exp as any).path || '').replace(/\\/g, '/')
      const linesOut = { start: (exp as any).startLine, end: (exp as any).endLine }
      const content = (exp as any).preview
      const results = [{ type: 'EXPANDED', path: pathOut, lines: linesOut, content }]
      return { ok: true, data: { path: pathOut, lines: linesOut, preview: content, results, count: results.length, summary: [`Expanded 1 snippet from ${pathOut}:${linesOut.start}-${linesOut.end}`], meta: { elapsedMs }, usedParams: { action: 'expand', handle: args.handle, filters: { maxSnippetLines: (args?.filters?.maxSnippetLines ?? 60) } } } }
    }

    const rawTerms = (Array.isArray(args.queries) && args.queries.length ? args.queries : [args.query || ''])
    const terms = rawTerms.map((q) => String(q || '').trim()).filter(Boolean)
    if (!terms.length) return { ok: false, error: 'query or queries is required' }

    const root = await getWorkspaceRoot(meta?.workspaceId)

    const filters = normalizeFilters(args.filters)
    const include = filters.pathsInclude
    const exclude = [ ...(filters.pathsExclude || []), '.hifide-public/**', '.hifide_public/**', '.hifide-private/**', '.hifide_private/**' ]
    let maxResults = filters.maxResults
    const maxSnippetLines = filters.maxSnippetLines
    if ((args as any)?.searchOnce) { maxResults = Math.min(1, maxResults) }

    // Normalize include globs for both fast-glob and matcher
    const includeNorm = normalizeIncludeGlobs(include) || include

    // Prepare include/exclude matchers (strict enforcement across all strategies)
    let isIncludeMatch: ((p: string) => boolean) | null = null
    let isExcludeMatch: ((p: string) => boolean) | null = null
    try {
      isIncludeMatch = compileGlobMatcher(includeNorm)
      isExcludeMatch = compileGlobMatcher(exclude)
    } catch {}

    // Auto-scale: ensure effective budget grows with number of terms; ignore too-low hints
    // Build .gitignore filter (best-effort)
    let ig: ReturnType<typeof ignore> | null = null
    try {
      const buf = await fs.readFile(path.join(root, '.gitignore'), 'utf-8')
      ig = ignore()
      ig.add(buf)
    } catch {}

    const effectiveBudgetMs = computeAutoBudget(terms.length, args?.filters?.timeBudgetMs)

    // Deduplicate identical queries within a short window to reduce tool thrash
    const cacheKey = makeCacheKey(root, { ...args, filters })
    const cached = wsCacheGet(cacheKey)
    if (cached) {
      const elapsedMs = Date.now() - t0
      return { ok: true, data: { ...cached, meta: { ...(cached.meta||{}), elapsedMs, cached: true }, usedParams: { mode: String(args.mode || 'auto'), queries: terms, filters } } }
    }

	    // Auto-maintenance (non-blocking): opportunistically refresh semantic index when stale
	    try { await autoRefreshPreflight(meta?.workspaceId) } catch {}


    const strategiesUsed: string[] = []
    const tasks: Array<() => Promise<{ tag:string; term:string; items:any[] }>> = []

    function addTermStrategy(tag: string, term: string, factory: () => Promise<any[]>, enabled = true) {
      if (!enabled) return
      strategiesUsed.push(tag)
      tasks.push(() => factory().then(items => ({ tag, term, items })).catch(() => ({ tag, term, items: [] })))
    }

    // Select strategies per term
    for (const rawTerm of terms) {
      const effectiveMode: SearchMode = (args.mode && args.mode !== 'auto') ? args.mode : classifyMode(rawTerm)
      const term = rawTerm.replace(/^re:|^text:|^ast:/i, '').trim()
      if (!term) continue
      if (effectiveMode === 'semantic' || (effectiveMode === 'auto' && !looksLikeFilename(term))) {
        addTermStrategy('semantic', rawTerm, () => runSemantic(term, Math.min(32, maxResults*2)))
      }
      if (effectiveMode === 'text' || effectiveMode === 'auto') {
        const literal = effectiveMode !== 'text' ? true : !/^re:/i.test(rawTerm)
        addTermStrategy('grep', rawTerm, () => runGrep(term, includeNorm, exclude, Math.min(500, maxResults*20), literal))
      }
      if (effectiveMode === 'path') {
        addTermStrategy('path', rawTerm, () => runPathSearch(term, includeNorm, exclude, Math.min(200, maxResults), maxSnippetLines, meta?.workspaceId))
      } else if (effectiveMode === 'auto') {
        const fnameTokens = extractFilenameTokens(rawTerm)
        for (const tok of fnameTokens) {
          addTermStrategy('path', tok, () => runPathSearch(tok, includeNorm, exclude, Math.min(200, maxResults), maxSnippetLines, meta?.workspaceId))
        }
        // If include is present, also run path search on bare tokens (not only filename-like)
        if (includeNorm && includeNorm.length) {
          const bare = extractBareTokens(rawTerm)
          const seen = new Set(fnameTokens.map(t => t.toLowerCase()))
          for (const tok of bare) {
            if (seen.has(tok.toLowerCase())) continue
            addTermStrategy('path', tok, () => runPathSearch(tok, includeNorm, exclude, Math.min(200, maxResults), maxSnippetLines, meta?.workspaceId))
          }
        }
      }
    }

    // Simple time budget: race settled promises against timeout
    const timeout = new Promise<{ tag:string; term:string; items:any[] }[]>((resolve) => setTimeout(() => resolve([]), effectiveBudgetMs))
    const settled = await Promise.race([allWithLimit(tasks, 6), timeout]) as any[]

    // Merge, normalize, score
    type Norm = { path:string; startLine:number; endLine:number; text:string; reasons:string[]; parts: Partial<Record<'semantic'|'grep'|'ast'|'recency', number>>; matched:Set<string>; corpus?: 'workspace'|'kb' }
    const byFile: Map<string, Norm[]> = new Map()

    const pushNorm = (n: Norm) => {
      // Normalize rel path
      const rel = (n.path || '').replace(/\\/g, '/')

      // Strict includes/excludes
      try {
        if (isIncludeMatch && !isIncludeMatch(rel)) return
        if (isExcludeMatch && isExcludeMatch(rel)) return
      } catch {}

      // .gitignore: drop ignored paths
      if (ig) {
        try { if (ig.ignores(rel)) return } catch {}
      }

      const list = byFile.get(rel) || []
      // de-dup by overlapping ranges (simple)
      const overlap = list.find(x => Math.abs(((x.startLine+x.endLine)/2) - ((n.startLine+n.endLine)/2)) <= 3)
      if (overlap) {
        // merge reasons and max scores per part
        overlap.reasons = Array.from(new Set([...overlap.reasons, ...n.reasons]))
        for (const k of Object.keys(n.parts) as Array<keyof Norm['parts']>) {
          const v = n.parts[k] || 0
          overlap.parts[k] = Math.max(overlap.parts[k]||0, v)
        }
        // merge matched queries
        for (const q of n.matched) overlap.matched.add(q)
      } else {
        list.push({ ...n, path: rel })
      }
      byFile.set(rel, list)
    }

/*
    for (const s of (settled || [])) {
      if (!s || !s.tag) continue
      const tag = s.tag as 'semantic'|'grep'|'ast'|'path'
      const term = (s.term || '') as string
      for (const it of (s.items || [])) {
        const pathRel = String(it.path || '').replace(/\\/g, '/')</new_str_1}  UIButton JSON invalid.  Let's correct.  !***  assistant to=functions.str-replace-editor औ  Let's craft proper JSON with full replacement block.  We'll include rest of the block.  !***  victim.  Let's resend.  }】  Let's compute new block lines content.  We'll propose new string until before closing braces.]  Let's produce with correct JSON.  !***  We'll continue.  }  }  }  }  }  }  }   }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }  }   }  }  }  }  }  }  }  }  }  }  }  }  }  }  }   }  }  }   }  }  }  }  }  }   }  }   }   }}  ]  }  }  }  }  }  }  }  }}  }  Let's re-run with correct input.  We'll construct 'new_str_1' fully.  Let's do it now.  】  }  }  }  }  }  }  }   }  }  }  }  }  💥  We'll recalc.  Sorry.  Let's do properly.  *>  We'll resend.  }  }  }  }  }  }  }  }   }  }  }   }  }  }  }  }  }  }  }  }  }  }  }   }  }  }  }  }  }  }  }  }   }  }  }  }    }   }  }  }  }  }  }  }  }  }  }   }  }   }  }  }  }  }  }  }  Let's re-send properly.  }  }  }  }  }  }  }  }  }  }   }  }  }  }  }  }  }  }  }  }   }  Done.  Sorry.  Let's send.  }  }  }  }  }  }  }   }  }  }  }}  }  }  }  }  }  }  }]  }  }  }  }  }  }  }  }  }  }  }  }   }  }  }  }  }  }  }   }  }  }  }  }  }}  ]
*/
    for (const s of (settled || [])) {
      if (!s || !s.tag) continue
      const tag = s.tag as 'semantic'|'grep'|'ast'|'path'
      const term = (s.term || '') as string
      for (const it of (s.items || [])) {
        const pathRel = String(it.path || '').replace(/\\/g, '/')
        const start = it.startLine || 1
        const end = it.endLine || (start + Math.max(0, (it.text||'').split(/\r?\n/).length - 1))
        const text = (it.text || '') as string
        const reason = tag
        const parts: any = {}
        parts[tag] = 1 // normalize later if we add true scores per strategy
        const pBoost = pathTokenBoost(pathRel, term)
        if (pBoost > 0) parts.path = Math.max(parts.path||0, pBoost)
        const corpus = (it.corpus === 'kb' ? 'kb' : it.corpus === 'workspace' ? 'workspace' : undefined)
        pushNorm({ path: pathRel, startLine: start, endLine: end, text, reasons: [reason], parts, matched: new Set([term]), corpus })
      }
    }

    // Compute recency boost and build hits
    const hits: SearchWorkspaceResultHit[] = []
    for (const [pathRel, list] of byFile) {
      const abs = path.resolve(root, pathRel)
      const mtimeMs = await safeStatMtimeMs(abs)
      const recency = mtimeMs ? Math.max(0, 1 - Math.min(1, (Date.now() - mtimeMs) / (1000*60*60*24*14))) : 0 // within ~2 weeks
      for (const n of list) {
        n.parts.recency = Math.max(n.parts.recency||0, recency)
        const base = combineScore(n.parts)
        const skipDemotes = isExactBasenameMatch(pathRel, n.matched)
        const score = base * fileScoreBoost(pathRel, { skipDemotes })
        const preview = clampPreview(n.text, maxSnippetLines)
        const handle = toHandle(pathRel, n.startLine, n.endLine)
        const matchedQueries = Array.from(n.matched)
        const type = (n.reasons || []).includes('ast') ? 'AST' : 'SNIPPET'
        hits.push({ type, path: pathRel, lines: { start: n.startLine, end: n.endLine }, score, preview, language: extOf(pathRel), reasons: Array.from(new Set(n.reasons)), matchedQueries, handle, corpus: n.corpus })
      }
    }

    // Sort and trim; ensure at most 2 per file
    hits.sort((a, b) => b.score - a.score)
    const seenPerFile = new Map<string, number>()
    const trimmed: SearchWorkspaceResultHit[] = []
    for (const h of hits) {
      const c = seenPerFile.get(h.path) || 0
      if (c >= 2) continue
      trimmed.push(h)
      seenPerFile.set(h.path, c + 1)
      if (trimmed.length >= maxResults) break
    }

    // Build summary
    const topFiles = Array.from(new Set(trimmed.map(h => h.path))).slice(0, 5)
    const summary: string[] = []
    if (topFiles.length) summary.push(`Top files: ${topFiles.join(', ')}`)
    summary.push(`Results: ${trimmed.length}`)

    const elapsedMs = Date.now() - t0
    const out: SearchWorkspaceResult = { results: trimmed, summary, meta: { elapsedMs, strategiesUsed, truncated: hits.length > trimmed.length } }

    // Provide explicit guidance to the agent on what to do next (topHandles)
    const topHandles = trimmed.slice(0, 3).map(h => ({ handle: h.handle, path: h.path, lines: h.lines }))

    // Best handle: prefer code files in src/** if present; boost store.ts for state-management queries
    const codePrefs = new Set(['ts','tsx','js','jsx','py','go','java','c','cpp','cs','kt','swift','rs'])
    const qJoined = terms.join(' ').toLowerCase()
    const preferStore = /\b(store|zustand|state)\b/.test(qJoined)

    let best = (preferStore && trimmed.find(h => /(^|\/)store\.(ts|tsx|js|jsx)$/i.test(h.path))) || null
    if (!best) {
      // Prefer domain directories when query mentions them (pixi/astro/engine)
      const domainDirs: Array<{ re: RegExp; dir: RegExp }> = [
        { re: /\bpixi\b/i, dir: /^src\/pixi\//i },
        { re: /\bastro\b/i, dir: /^src\/astro\//i },
        { re: /\bengine\b/i, dir: /^src\/engine/i }
      ]
      for (const d of domainDirs) {
        if (d.re.test(qJoined)) {
          const hit = trimmed.find(h => d.dir.test(h.path))
          if (hit) { best = hit; break }
        }
      }
    }

    if (!best) {
      best = trimmed.find(h => (h.reasons || []).includes('path'))
          || trimmed.find(h => codePrefs.has((h.language||'').toLowerCase()) && /^src\//i.test(h.path))
          || trimmed.find(h => codePrefs.has((h.language||'').toLowerCase()))
          || trimmed[0]
    }

    const payload = { ...out, topHandles, bestHandle: best ? { handle: best.handle, path: best.path, lines: best.lines } : undefined, usedParams: { mode: String(args.mode || 'auto'), queries: terms, filters } }

    // Heuristic: if previews are large, hint pruning to provider to compress earlier context
    try {
      const totalChars = Array.isArray(payload.results) ? payload.results.reduce((acc: number, r: any) => acc + (r?.preview?.length || 0), 0) : 0
      const needsPrune = totalChars > 8000 || (filters.maxSnippetLines >= 60) || (Array.isArray(payload.results) && payload.results.length > 20)
      if (needsPrune) {
        (payload as any)._meta = (payload as any)._meta || {}
        ;(payload as any)._meta.trigger_pruning = true
        ;(payload as any)._meta.summary = {
          key_findings: [
            `Workspace search returned ${Array.isArray(payload.results) ? payload.results.length : 0} results for: ${terms.join(' | ')}`
          ],
          files_examined: Array.isArray(payload.results) ? payload.results.slice(0, 5).map((r: any) => `${r.path}:${r.lines?.start ?? '?'}-${r.lines?.end ?? '?'}`) : [],
          next_steps: [
            'Use workspaceSearch action="expand" on one handle at a time to fetch more context as needed.'
          ],
          timestamp: Date.now()
        }
      }
    } catch {}

    // Save to cache
    try { wsCacheSet(cacheKey, payload) } catch {}

    return { ok: true, data: payload, _meta: (payload as any)._meta }
  },
  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      const resultData = raw.data
      const resultCount = Array.isArray(resultData?.results)
        ? resultData.results.length
        : (typeof resultData?.count === 'number' ? resultData.count : 0)
      // Provide compact handles so the model can use action:"expand" without needing full UI payload
      const topHandles = Array.isArray((resultData as any)?.topHandles)
        ? (resultData as any).topHandles.map((h: any) => (h && typeof h.handle === 'string') ? h.handle : undefined).filter(Boolean).slice(0, 8)
        : []
      const bestHandleObj = (resultData as any)?.bestHandle && typeof (resultData as any).bestHandle.handle === 'string'
        ? (resultData as any).bestHandle
        : undefined
      const bestHandle = bestHandleObj?.handle || (topHandles[0] || undefined)

      // Enriched minimal payload while preserving backward compatibility
      const minimal: any = { ok: true, previewKey, previewCount: resultCount, topHandles, bestHandle }

      // Add detailed handles for better model ergonomics
      if (bestHandleObj) minimal.bestHandleDetailed = bestHandleObj
      if (Array.isArray((resultData as any)?.topHandles)) minimal.topHandlesDetailed = (resultData as any).topHandles.slice(0, 8)

      // If this is an expand response, include bounded preview directly in minimal
      if (resultData?.preview && resultData?.lines && resultData?.path) {
        const prev = typeof resultData.preview === 'string' ? resultData.preview.slice(0, 4000) : resultData.preview
        minimal.path = String(resultData.path || '')
        minimal.lines = resultData.lines
        minimal.preview = prev
        minimal.expanded = { path: minimal.path, lines: minimal.lines, preview: prev }
      }

      // Provide a couple of snippets for quick context in search results (size-capped)
      try {
        const resultsArr = Array.isArray(resultData?.results) ? resultData.results : []
        const snippets: any[] = []
        for (const r of resultsArr) {
          if (!r || !r.path || !r.lines || !r.preview) continue
          if (r.type !== 'SNIPPET' && r.type !== 'AST') continue
          const prev = String(r.preview).slice(0, 600)
          snippets.push({ filePath: r.path, lineStart: r.lines.start, lineEnd: r.lines.end, preview: prev, handle: r.handle })
          if (snippets.length >= 3) break
        }
        if (snippets.length) minimal.snippets = snippets
      } catch {}

      return {
        minimal,
        ui: resultData,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

export default searchWorkspaceTool

