import type { AgentTool } from '../../providers/provider'
import { astGrepSearch } from '../astGrep'
import path from 'node:path'
import { useMainStore } from '../../store/index'

// In-memory TTL cache to collapse repeated identical AST searches
const __astSearchCache: Map<string, { ts: number; data: any }> = new Map()
const AST_CACHE_TTL_MS = 20_000 // 20s
const AST_CACHE_MAX = 64

function astKey(args: { pattern: string; languages?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; maxMatches?: number; contextLines?: number; maxFileBytes?: number; concurrency?: number }, workspaceId?: string) {
  const root = path.resolve(workspaceId || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd())
  const keyObj = {
    root,
    pattern: args.pattern,
    languages: Array.isArray(args.languages) ? [...args.languages].sort() : [],
    includeGlobs: Array.isArray(args.includeGlobs) ? [...args.includeGlobs].sort() : [],
    excludeGlobs: Array.isArray(args.excludeGlobs) ? [...args.excludeGlobs].sort() : [],
    maxMatches: args.maxMatches ?? 500,
    contextLines: args.contextLines ?? 2,
    maxFileBytes: args.maxFileBytes ?? 1_000_000,
    concurrency: args.concurrency ?? 6,
  }
  return JSON.stringify(keyObj)
}

function astCacheGet(key: string) {
  const v = __astSearchCache.get(key)
  if (!v) return null
  if (Date.now() - v.ts > AST_CACHE_TTL_MS) { __astSearchCache.delete(key); return null }
  return v.data
}

function astCacheSet(key: string, data: any) {
  __astSearchCache.set(key, { ts: Date.now(), data })
  if (__astSearchCache.size > AST_CACHE_MAX) {
    const first = __astSearchCache.keys().next().value
    if (first) __astSearchCache.delete(first)
  }
}

export const searchAstTool: AgentTool = {
  name: 'codeSearchAst',
  description: 'AST-first structural search using ast-grep to discover code shapes without reading whole files. Supports registered languages; use inline patterns like console.log($A) or function $NAME($PARAMS) { $$BODY }.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'ast-grep inline pattern, e.g., console.log($A), import { $SYM } from \u0027$PKG\u0027' },
      languages: { type: 'array', items: { type: 'string' }, description: "Optional languages; default 'auto' (uses registered langs by file extension)" },
      includeGlobs: { type: 'array', items: { type: 'string' } },
      excludeGlobs: { type: 'array', items: { type: 'string' } },
      maxMatches: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
      contextLines: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
      maxFileBytes: { type: 'integer', minimum: 1, default: 1000000 },
      concurrency: { type: 'integer', minimum: 1, maximum: 32, default: 6 },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  run: async (args: { pattern: string; languages?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; maxMatches?: number; contextLines?: number; maxFileBytes?: number; concurrency?: number }, meta?: any) => {
    // Cache collapse for identical calls within short window
    const key = astKey(args, meta?.workspaceId)
    const cached = astCacheGet(key)
    if (cached) {
      return { ok: true, ...cached, cached: true }
    }
    try {
      const res = await astGrepSearch({
        pattern: args.pattern,
        languages: (args.languages && args.languages.length) ? args.languages : 'auto',
        includeGlobs: args.includeGlobs,
        excludeGlobs: args.excludeGlobs,
        maxMatches: args.maxMatches,
        contextLines: args.contextLines,
        maxFileBytes: args.maxFileBytes,
        concurrency: args.concurrency,
      })
      try { astCacheSet(key, res) } catch {}
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

