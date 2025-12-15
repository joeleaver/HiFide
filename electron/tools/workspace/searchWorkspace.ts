import type { AgentTool } from '../../providers/provider'
import { grepTool } from '../text/grep'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { discoverWorkspaceFiles } from '../../utils/fileDiscovery'
import { resolveWithinWorkspace } from '../utils'

/**
 * Simplified workspace search tool powered entirely by ripgrep.
 * Returns simple file paths and line numbers without handles, expand, or jump functions.
 */

export interface SearchWorkspaceParams {
  query: string
  filters?: {
    pathsInclude?: string[]
    pathsExclude?: string[]
    maxResults?: number
  }
}

export interface SearchWorkspaceResult {
  path: string
  lineNumber: number
  line: string
}

const TOKEN_SPLIT_REGEX = /[^A-Za-z0-9_]+/
const MAX_TOKEN_COUNT = 5
const MIN_TOKEN_LENGTH = 2
const MIN_RESULTS_PER_TOKEN = 75
const MAX_RESULTS_PER_TOKEN = 500
const MAX_PATH_DISCOVERY = 20_000
const MIN_PATH_QUERY_LENGTH = 2
const PATH_MATCH_LINE = '[file path match]'

type TokenizedSearchMeta = {
  results: SearchWorkspaceResult[]
  filesMatched: number
  summary: string
  truncated: boolean
  tokensUsed: string[]
}

type PathSearchMeta = {
  results: SearchWorkspaceResult[]
  filesMatched: number
  summary: string
  truncated: boolean
  tokensUsed: string[]
  filesScanned: number
}

function mapMatches(matches: any[]): SearchWorkspaceResult[] {
  return matches.map((m: any) => ({
    path: m.file,
    lineNumber: typeof m.lineNumber === 'number' ? m.lineNumber : Number(m.lineNumber ?? 0),
    line: typeof m.line === 'string' ? m.line : ''
  }))
}

function tokenizeQuery(query: string): string[] {
  const rawTokens = query
    .split(TOKEN_SPLIT_REGEX)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)

  const unique: string[] = []
  const seen = new Set<string>()

  for (const token of rawTokens) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(token)
    if (unique.length >= MAX_TOKEN_COUNT) break
  }

  return unique
}

function countOccurrences(target: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = target.indexOf(needle)
  while (index !== -1) {
    count++
    index = target.indexOf(needle, index + needle.length)
  }
  return count
}

// Tokenized search ranking uses fallback heuristics for multi-term queries.
async function runTokenizedFallback({
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: {
  tokens: string[]
  include: string[]
  exclude: string[]
  maxResults: number
  meta?: any
}): Promise<TokenizedSearchMeta> {
  const perTokenLimit = Math.min(
    MAX_RESULTS_PER_TOKEN,
    Math.max(MIN_RESULTS_PER_TOKEN, maxResults * 3)
  )

  const fileAggregates = new Map<string, {
    matches: Map<string, SearchWorkspaceResult>
    tokensMatched: Set<string>
    totalMatches: number
  }>()

  let tokenSearchTruncated = false

  for (const token of tokens) {
    const tokenResult: any = await grepTool.run({
      pattern: token,
      files: include,
      options: {
        exclude,
        maxResults: perTokenLimit,
        lineNumbers: true,
        literal: true,
        ignoreCase: true
      }
    }, meta)

    if (!tokenResult?.ok) continue

    if (tokenResult.data?.summary?.truncated) {
      tokenSearchTruncated = true
    }

    const matches = tokenResult.data?.matches || []
    for (const match of matches) {
      if (!match?.file) continue
      const path = match.file
      const lineNumber = typeof match.lineNumber === 'number'
        ? match.lineNumber
        : Number(match.lineNumber ?? 0)
      const line = typeof match.line === 'string' ? match.line : ''
      const key = `${lineNumber}:${line}`

      if (!fileAggregates.has(path)) {
        fileAggregates.set(path, {
          matches: new Map(),
          tokensMatched: new Set(),
          totalMatches: 0
        })
      }

      const agg = fileAggregates.get(path)!
      if (!agg.matches.has(key)) {
        agg.matches.set(key, { path, lineNumber, line })
      }
      agg.tokensMatched.add(token)
      agg.totalMatches++
    }
  }

  const rankedFiles = Array.from(fileAggregates.entries())
    .map(([path, agg]) => ({
      path,
      matches: Array.from(agg.matches.values()).sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0)),
      tokensMatched: agg.tokensMatched,
      totalMatches: agg.totalMatches
    }))
    .sort((a, b) => {
      if (b.tokensMatched.size !== a.tokensMatched.size) {
        return b.tokensMatched.size - a.tokensMatched.size
      }
      if (b.totalMatches !== a.totalMatches) {
        return b.totalMatches - a.totalMatches
      }
      return a.path.localeCompare(b.path)
    })

  const flattened: SearchWorkspaceResult[] = []
  let flattenedTruncated = false

  outer: for (const file of rankedFiles) {
    for (const match of file.matches) {
      flattened.push(match)
      if (flattened.length >= maxResults) {
        flattenedTruncated = true
        break outer
      }
    }
  }

  const filesMatched = rankedFiles.filter((file) => file.matches.length > 0).length
  const summary = flattened.length > 0
    ? `Tokenized search found ${flattened.length} match${flattened.length === 1 ? '' : 'es'} across ${filesMatched} file(s) using tokens: ${tokens.join(', ')}`
    : `Tokenized search found no matches for tokens: ${tokens.join(', ')}`

  return {
    results: flattened,
    filesMatched,
    summary,
    truncated: tokenSearchTruncated || flattenedTruncated,
    tokensUsed: tokens
  }
}

async function runPathSearch({
  query,
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: {
  query: string
  tokens: string[]
  include: string[]
  exclude: string[]
  maxResults: number
  meta?: any
}): Promise<PathSearchMeta | null> {
  const baseTokens = tokens.length
    ? tokens
    : (query.length >= MIN_PATH_QUERY_LENGTH ? [query] : [])

  const normalizedTokens = baseTokens
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_PATH_QUERY_LENGTH)

  if (!normalizedTokens.length) return null

  const root = resolveWithinWorkspace('.', meta?.workspaceId)

  let discovered: string[]
  try {
    discovered = await discoverWorkspaceFiles({
      cwd: root,
      includeGlobs: include,
      excludeGlobs: exclude,
      respectGitignore: true,
      includeDotfiles: true,
      absolute: true
    })
  } catch {
    return null
  }

  let truncated = false
  let candidates = discovered
  if (discovered.length > MAX_PATH_DISCOVERY) {
    candidates = discovered.slice(0, MAX_PATH_DISCOVERY)
    truncated = true
  }

  const filesScanned = candidates.length

  const tokenData = normalizedTokens.map((token) => ({
    original: token,
    lower: token.toLowerCase()
  }))
  const minTokensForMatch = normalizedTokens.length >= 2 ? Math.min(2, normalizedTokens.length) : 1

  const scored: Array<{
    path: string
    tokensMatched: Set<string>
    totalMatches: number
    fileNameMatches: number
    relLength: number
  }> = []

  for (const absPath of candidates) {
    const rel = path.relative(root, absPath).replace(/\\/g, '/')
    const relLower = rel.toLowerCase()
    const basenameLower = path.basename(rel).toLowerCase()
    const tokensMatched = new Set<string>()
    let totalMatches = 0
    let fileNameMatches = 0

    for (const token of tokenData) {
      const hits = countOccurrences(relLower, token.lower)
      if (hits > 0) {
        tokensMatched.add(token.original)
        totalMatches += hits
        fileNameMatches += countOccurrences(basenameLower, token.lower)
      }
    }

    if (tokensMatched.size >= minTokensForMatch) {
      scored.push({
        path: rel,
        tokensMatched,
        totalMatches,
        fileNameMatches,
        relLength: rel.length
      })
    }
  }

  scored.sort((a, b) => {
    if (b.tokensMatched.size !== a.tokensMatched.size) {
      return b.tokensMatched.size - a.tokensMatched.size
    }
    if (b.fileNameMatches !== a.fileNameMatches) {
      return b.fileNameMatches - a.fileNameMatches
    }
    if (b.totalMatches !== a.totalMatches) {
      return b.totalMatches - a.totalMatches
    }
    if (a.relLength !== b.relLength) {
      return a.relLength - b.relLength
    }
    return a.path.localeCompare(b.path)
  })

  const selected = scored.slice(0, maxResults)
  const results: SearchWorkspaceResult[] = selected.map((entry) => ({
    path: entry.path,
    lineNumber: 0,
    line: PATH_MATCH_LINE
  }))

  const filesMatched = selected.length
  const summary = filesMatched > 0
    ? `Path search found ${filesMatched} match${filesMatched === 1 ? '' : 'es'} across ${filesMatched} file(s)`
    : `Path search found no matches for tokens: ${normalizedTokens.join(', ')}`

  return {
    results,
    filesMatched,
    summary,
    truncated: truncated || scored.length > selected.length,
    tokensUsed: normalizedTokens,
    filesScanned
  }
}

export const searchWorkspaceTool: AgentTool = {
  name: 'workspaceSearch',
  description: 'Multi-stage workspace search. Runs ripgrep for literal/regex queries, then falls back to file-path token search and case-insensitive tokenized content search—returning ranked file paths, line numbers, and metadata about how each match was found.',
  parameters: {
    type: 'object',
    properties: {
      query: { 
        type: 'string', 
        description: 'Search pattern (literal text or regex). Examples: "function handleClick", "class.*extends", "TODO:"' 
      },
      filters: {
        type: 'object',
        properties: {
          pathsInclude: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Glob patterns to include (e.g., ["src/**/*.ts", "electron/**/*.ts"])'
          },
          pathsExclude: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Glob patterns to exclude (e.g., ["**/*.test.ts", "dist/**"])'
          },
          maxResults: { 
            type: 'integer', 
            minimum: 1,
            description: 'Maximum number of results to return (default: 50)'
          }
        },
        additionalProperties: false
      }
    },
    required: ['query'],
    additionalProperties: false
  },

  run: async (args: SearchWorkspaceParams, meta?: any): Promise<any> => {
    const t0 = Date.now()
    
    if (!args.query || !args.query.trim()) {
      return { ok: false, error: 'query is required' }
    }

    const query = args.query.trim()
    const maxResults = args.filters?.maxResults ?? 50
    const include = args.filters?.pathsInclude && args.filters.pathsInclude.length 
      ? args.filters.pathsInclude 
      : ['**/*']
    const exclude = [
      ...(args.filters?.pathsExclude || []),
      '.hifide-public/**',
      '.hifide_public/**',
      '.hifide-private/**',
      '.hifide_private/**',
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      '.git/**'
    ]

    // Use grep tool with ripgrep backend
    const grepResult: any = await grepTool.run({
      pattern: query,
      files: include,
      options: {
        exclude,
        maxResults,
        lineNumbers: true,
        ignoreCase: false,
        literal: false // Allow regex by default
      }
    }, meta)

    if (!grepResult?.ok) {
      return { ok: false, error: grepResult?.error || 'Search failed' }
    }

    const results = mapMatches(grepResult.data?.matches || [])
    if (results.length > 0) {
      const filesMatched = new Set(results.map((r) => r.path)).size
      const summary = `Found ${results.length} match${results.length === 1 ? '' : 'es'} in ${filesMatched} file(s)`
      return {
        ok: true,
        data: {
          results,
          count: results.length,
          summary,
          meta: {
            elapsedMs: Date.now() - t0,
            filesMatched,
            truncated: grepResult.data?.summary?.truncated || false,
            mode: 'pattern'
          }
        }
      }
    }

    const tokens = tokenizeQuery(query)

    const pathSearch = await runPathSearch({
      query,
      tokens,
      include,
      exclude,
      maxResults,
      meta
    })

    if (pathSearch && pathSearch.results.length > 0) {
      const elapsedMs = Date.now() - t0
      return {
        ok: true,
        data: {
          results: pathSearch.results,
          count: pathSearch.results.length,
          summary: pathSearch.summary,
          meta: {
            elapsedMs,
            filesMatched: pathSearch.filesMatched,
            truncated: pathSearch.truncated,
            mode: 'path',
            tokens: pathSearch.tokensUsed,
            filesScanned: pathSearch.filesScanned
          }
        }
      }
    }

    if (tokens.length >= 2) {
      const tokenized = await runTokenizedFallback({
        tokens,
        include,
        exclude,
        maxResults,
        meta
      })

      if (tokenized.results.length > 0) {
        const elapsedMs = Date.now() - t0
        return {
          ok: true,
          data: {
            results: tokenized.results,
            count: tokenized.results.length,
            summary: tokenized.summary,
            meta: {
              elapsedMs,
              filesMatched: tokenized.filesMatched,
              truncated: tokenized.truncated,
              mode: 'tokenized',
              tokens: tokenized.tokensUsed
            }
          }
        }
      }
    }

    return {
      ok: true,
      data: {
        results: [],
        count: 0,
        summary: 'No matches found in file contents or paths',
        meta: {
          elapsedMs: Date.now() - t0,
          filesMatched: 0,
          truncated: false,
          mode: 'none'
        }
      }
    }
  },

  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      const resultData = raw.data
      const resultCount = resultData?.count || 0
      const results = resultData?.results || []

      // Format results for LLM: include file paths, line numbers, and matched lines
      // Group by file for better readability
      const fileGroups = new Map<string, Array<{ lineNumber: number; line: string }>>()
      for (const result of results) {
        if (!fileGroups.has(result.path)) {
          fileGroups.set(result.path, [])
        }
        fileGroups.get(result.path)!.push({
          lineNumber: result.lineNumber,
          line: result.line
        })
      }

      const formattedResults = Array.from(fileGroups.entries()).map(([path, matches]) => ({
        file: path,
        matches: matches.map(m => `  Line ${m.lineNumber}: ${m.line.trim()}`)
      }))

      return {
        minimal: {
          ok: true,
          count: resultCount,
          summary: resultData.summary,
          results: formattedResults,
          resultCount
        },
        ui: resultData,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

export default searchWorkspaceTool

