/**
 * Workspace-specific search strategies.
 * Each strategy returns ScoredResult[] for unified ranking.
 */

import path from 'node:path'
import { grepTool } from '../text/grep'
import { discoverWorkspaceFiles } from '../../utils/fileDiscovery'
import { resolveWithinWorkspace } from '../utils'
import { getVectorService } from '../../services/index.js'
import { resolveWorkspaceRoot } from '../../utils/workspace.js'
import {
  type ScoredResult,
  type BaseSearchResult,
  SCORE_FILENAME_EXACT,
  SCORE_FILENAME_PARTIAL,
  SCORE_SEMANTIC_MIN_THRESHOLD,
  SCORE_TOKENIZED_BASE,
  SCORE_PATH_BASE,
  calculateGrepScore,
  getPathDepth
} from './scoring'

// =============================================================================
// Types
// =============================================================================

export interface SearchWorkspaceResult extends BaseSearchResult {
  path: string
  lineNumber: number
  line: string
}

export interface WorkspaceSearchParams {
  query: string
  include: string[]
  exclude: string[]
  maxResults: number
  meta?: any
}

export interface TokenSearchParams {
  tokens: string[]
  include: string[]
  exclude: string[]
  maxResults: number
  meta?: any
}

// =============================================================================
// Constants
// =============================================================================

const TOKEN_SPLIT_REGEX = /[^A-Za-z0-9_]+/
const MAX_TOKEN_COUNT = 5
const MIN_TOKEN_LENGTH = 2
const MIN_RESULTS_PER_TOKEN = 75
const MAX_RESULTS_PER_TOKEN = 500
const MAX_PATH_DISCOVERY = 20_000
const MIN_PATH_QUERY_LENGTH = 2
export const PATH_MATCH_LINE = '[file path match]'
export const FILENAME_MATCH_LINE = '[filename match]'

// =============================================================================
// Query Utilities
// =============================================================================

/**
 * Tokenize a query string into searchable tokens
 */
export function tokenizeQuery(query: string): string[] {
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

/**
 * Count occurrences of needle in target string
 */
export function countOccurrences(target: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = target.indexOf(needle)
  while (index !== -1) {
    count++
    index = target.indexOf(needle, index + needle.length)
  }
  return count
}

// =============================================================================
// Filename Search
// =============================================================================

/**
 * Search for files whose filename matches the query
 * Returns highest-priority results (exact match = 1.0, partial = 0.95)
 */
export async function runFilenameSearch({
  query,
  include,
  exclude,
  maxResults,
  meta
}: WorkspaceSearchParams): Promise<ScoredResult<SearchWorkspaceResult>[]> {
  if (!query || query.length < 2) return []

  const root = resolveWithinWorkspace('.', meta?.workspaceId)
  const queryLower = query.toLowerCase()

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
    return []
  }

  const candidates = discovered.slice(0, MAX_PATH_DISCOVERY)
  const results: ScoredResult<SearchWorkspaceResult>[] = []

  for (const absPath of candidates) {
    const relativePath = path.relative(root, absPath)
    const filename = path.basename(absPath)
    const filenameLower = filename.toLowerCase()
    const filenameNoExt = path.parse(filename).name.toLowerCase()

    let score = 0
    if (filenameNoExt === queryLower || filenameLower === queryLower) {
      score = SCORE_FILENAME_EXACT
    } else if (filenameLower.includes(queryLower)) {
      const matchRatio = queryLower.length / filenameLower.length
      score = SCORE_FILENAME_PARTIAL * (0.5 + 0.5 * matchRatio)
    } else if (filenameNoExt.includes(queryLower)) {
      const matchRatio = queryLower.length / filenameNoExt.length
      score = SCORE_FILENAME_PARTIAL * (0.5 + 0.5 * matchRatio)
    }

    if (score > 0) {
      results.push({
        path: relativePath,
        lineNumber: 0,
        line: FILENAME_MATCH_LINE,
        score,
        source: 'filename'
      })
    }

    if (results.length >= maxResults * 2) break
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, maxResults)
}

// =============================================================================
// Grep Search
// =============================================================================

/**
 * Run grep search and return scored results
 * Scores based on match position in line, path depth, and match density per file
 */
export async function runScoredGrepSearch({
  query,
  include,
  exclude,
  maxResults,
  meta
}: WorkspaceSearchParams): Promise<ScoredResult<SearchWorkspaceResult>[]> {
  const grepResult: any = await grepTool.run({
    pattern: query,
    files: include,
    options: {
      exclude,
      maxResults: maxResults * 3, // Get extra for scoring
      lineNumbers: true,
      ignoreCase: false,
      literal: false
    }
  }, meta)

  if (!grepResult?.ok) return []

  const rawMatches = grepResult.data?.matches || []
  if (rawMatches.length === 0) return []

  // Calculate per-file match counts for density scoring
  const fileMatchCounts = new Map<string, number>()
  for (const m of rawMatches) {
    const file = m.file || ''
    fileMatchCounts.set(file, (fileMatchCounts.get(file) || 0) + 1)
  }
  const maxMatchCount = Math.max(...fileMatchCounts.values(), 1)

  // Calculate max path depth for normalization
  const pathDepths = rawMatches.map((m: any) => getPathDepth(m.file || ''))
  const maxPathDepth = Math.max(...pathDepths, 1)

  const queryLower = query.toLowerCase()

  const scoredResults: ScoredResult<SearchWorkspaceResult>[] = rawMatches.map((m: any) => {
    const file = m.file || ''
    const line = typeof m.line === 'string' ? m.line : ''
    const lineNumber = typeof m.lineNumber === 'number' ? m.lineNumber : Number(m.lineNumber ?? 0)

    const lineLower = line.toLowerCase()
    const matchPosition = lineLower.indexOf(queryLower)
    const effectivePosition = matchPosition >= 0 ? matchPosition : line.length / 2

    const pathDepth = getPathDepth(file)
    const matchCount = fileMatchCounts.get(file) || 1

    const score = calculateGrepScore(
      effectivePosition,
      line.length,
      pathDepth,
      maxPathDepth,
      matchCount,
      maxMatchCount
    )

    return {
      path: file,
      lineNumber,
      line,
      score,
      source: 'grep' as const
    }
  })

  scoredResults.sort((a, b) => b.score - a.score)
  return scoredResults.slice(0, maxResults)
}


// =============================================================================
// Tokenized Search (Multi-term fallback)
// =============================================================================

interface TokenizedSearchMeta {
  results: SearchWorkspaceResult[]
  filesMatched: number
  summary: string
  truncated: boolean
  tokensUsed: string[]
}

/**
 * Internal tokenized search with file aggregation
 */
async function runTokenizedFallback({
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: TokenSearchParams): Promise<TokenizedSearchMeta> {
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
      const filePath = match.file
      const lineNumber = typeof match.lineNumber === 'number'
        ? match.lineNumber
        : Number(match.lineNumber ?? 0)
      const line = typeof match.line === 'string' ? match.line : ''
      const key = `${lineNumber}:${line}`

      if (!fileAggregates.has(filePath)) {
        fileAggregates.set(filePath, {
          matches: new Map(),
          tokensMatched: new Set(),
          totalMatches: 0
        })
      }

      const agg = fileAggregates.get(filePath)!
      if (!agg.matches.has(key)) {
        agg.matches.set(key, { path: filePath, lineNumber, line })
      }
      agg.tokensMatched.add(token)
      agg.totalMatches++
    }
  }

  const rankedFiles = Array.from(fileAggregates.entries())
    .map(([filePath, agg]) => ({
      path: filePath,
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

/**
 * Run tokenized search and return scored results
 * Uses position-based scoring within the SCORE_TOKENIZED_BASE range
 */
export async function runScoredTokenizedSearch({
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: TokenSearchParams): Promise<ScoredResult<SearchWorkspaceResult>[]> {
  const result = await runTokenizedFallback({ tokens, include, exclude, maxResults, meta })
  if (!result.results.length) return []

  const count = result.results.length
  return result.results.map((r, idx) => ({
    ...r,
    score: SCORE_TOKENIZED_BASE + (0.1 * (1 - idx / Math.max(count, 1))),
    source: 'tokenized' as const
  }))
}


// =============================================================================
// Path Search
// =============================================================================

interface PathSearchMeta {
  results: SearchWorkspaceResult[]
  filesMatched: number
  summary: string
  truncated: boolean
  tokensUsed: string[]
  filesScanned: number
}

/**
 * Internal path search implementation
 */
async function runPathSearch({
  query,
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: WorkspaceSearchParams & { tokens: string[] }): Promise<PathSearchMeta | null> {
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

/**
 * Run path search and return scored results
 * Uses position-based scoring within the SCORE_PATH_BASE range
 */
export async function runScoredPathSearch({
  query,
  tokens,
  include,
  exclude,
  maxResults,
  meta
}: WorkspaceSearchParams & { tokens: string[] }): Promise<ScoredResult<SearchWorkspaceResult>[]> {
  const result = await runPathSearch({ query, tokens, include, exclude, maxResults, meta })
  if (!result?.results.length) return []

  const count = result.results.length
  return result.results.map((r, idx) => ({
    ...r,
    score: SCORE_PATH_BASE + (0.15 * (1 - idx / Math.max(count, 1))),
    source: 'path' as const
  }))
}


// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Run semantic search and return scored results
 * Filters out results below threshold and passes through raw scores
 */
export async function runScoredSemanticSearch({
  query,
  maxResults,
  meta,
  collection = 'code'
}: {
  query: string
  maxResults: number
  meta?: any
  collection?: 'code' | 'kb'
}): Promise<ScoredResult<SearchWorkspaceResult>[]> {
  try {
    const vectorService = getVectorService()
    const workspaceRoot = resolveWorkspaceRoot(meta?.workspaceId)

    await vectorService.init(workspaceRoot)
    const matches = await vectorService.search(query, maxResults * 2, collection)

    if (!matches || matches.length === 0) return []

    const results: ScoredResult<SearchWorkspaceResult>[] = matches
      .filter((m: any) => (m.score || 0) >= SCORE_SEMANTIC_MIN_THRESHOLD)
      .map((m: any) => {
        const type = m.symbolType ? `${m.symbolType} ` : ''
        const name = m.symbolName ? `${m.symbolName}: ` : ''
        const score = m.score || 0

        return {
          path: m.filePath || 'unknown',
          lineNumber: m.startLine || 1,
          line: `[semantic] (${(score * 100).toFixed(0)}%) ${type}${name}${(m.text || '').split('\n')[0]}...`,
          score,
          source: 'semantic' as const
        }
      })

    return results.slice(0, maxResults)
  } catch {
    return []
  }
}
