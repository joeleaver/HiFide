/**
 * Shared scoring utilities for search tools.
 * Used by workspaceSearch, knowledgeBaseSearch, and other search tools.
 */

/**
 * Base result interface that all search results extend
 */
export interface BaseSearchResult {
  path: string
  lineNumber: number
  line: string
}

/**
 * Source types for scored results
 */
export type SearchSource = 
  | 'filename' 
  | 'semantic' 
  | 'grep' 
  | 'tokenized' 
  | 'path'
  | 'kb-title'
  | 'kb-tag'
  | 'kb-body'
  | 'kb-semantic'

/**
 * Scored result for unified ranking across all search methods
 */
export type ScoredResult<T extends BaseSearchResult = BaseSearchResult> = T & {
  score: number
  source: SearchSource
}

// =============================================================================
// Scoring Constants
// =============================================================================

/** Exact filename match (highest priority) */
export const SCORE_FILENAME_EXACT = 1.0

/** Partial filename match */
export const SCORE_FILENAME_PARTIAL = 0.95

/** Minimum threshold for semantic results to be included */
export const SCORE_SEMANTIC_MIN_THRESHOLD = 0.4

/** Base score for grep matches */
export const SCORE_GREP_BASE = 0.55

/** Bonus for match at start of line */
export const SCORE_GREP_POSITION_BONUS = 0.1

/** Bonus for shorter paths */
export const SCORE_GREP_PATH_BONUS = 0.05

/** Bonus for files with many matches */
export const SCORE_GREP_DENSITY_BONUS = 0.05

/** Base score for tokenized search results */
export const SCORE_TOKENIZED_BASE = 0.4

/** Base score for path search results */
export const SCORE_PATH_BASE = 0.35

// =============================================================================
// Scoring Functions
// =============================================================================

/**
 * Calculate grep result score based on match position, path depth, and density
 */
export function calculateGrepScore(
  matchPositionInLine: number,
  lineLength: number,
  pathDepth: number,
  maxPathDepth: number,
  matchCountInFile: number,
  maxMatchCountInFile: number
): number {
  let score = SCORE_GREP_BASE

  // Position bonus: earlier in line = higher score (0 to SCORE_GREP_POSITION_BONUS)
  if (lineLength > 0) {
    const positionRatio = 1 - Math.min(matchPositionInLine / lineLength, 1)
    score += positionRatio * SCORE_GREP_POSITION_BONUS
  }

  // Path bonus: shorter/shallower paths = higher score (0 to SCORE_GREP_PATH_BONUS)
  if (maxPathDepth > 0) {
    const pathRatio = 1 - (pathDepth / maxPathDepth)
    score += pathRatio * SCORE_GREP_PATH_BONUS
  }

  // Density bonus: more matches in file = higher score (0 to SCORE_GREP_DENSITY_BONUS)
  if (maxMatchCountInFile > 1) {
    const densityRatio = (matchCountInFile - 1) / (maxMatchCountInFile - 1)
    score += densityRatio * SCORE_GREP_DENSITY_BONUS
  }

  return Math.min(score, 0.7) // Cap at 0.7 so high semantic scores beat grep
}

/**
 * Get path depth (number of directory levels)
 */
export function getPathDepth(filePath: string): number {
  return filePath.split(/[/\\]/).filter(Boolean).length
}

/**
 * Calculate position-based score for ranked results
 * First result gets highest score in range, last gets base score
 */
export function calculatePositionScore(
  index: number,
  totalCount: number,
  baseScore: number,
  bonusRange: number
): number {
  if (totalCount <= 1) return baseScore + bonusRange
  return baseScore + (bonusRange * (1 - index / (totalCount - 1)))
}

// =============================================================================
// Merge and Dedupe Utilities
// =============================================================================

/**
 * Merge multiple scored result arrays, sort by score, dedupe by file
 */
export function mergeAndDedupeResults<T extends BaseSearchResult>(
  resultArrays: ScoredResult<T>[][],
  maxResults: number
): ScoredResult<T>[] {
  // Flatten all results
  const allResults = resultArrays.flat()

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score)

  // Dedupe by file (keep first/highest-scored entry per file)
  const seenFiles = new Set<string>()
  const deduped: ScoredResult<T>[] = []

  for (const result of allResults) {
    if (!seenFiles.has(result.path)) {
      seenFiles.add(result.path)
      deduped.push(result)
    }
    if (deduped.length >= maxResults) break
  }

  return deduped
}

/**
 * Merge results allowing multiple entries per file (by file:lineNumber key)
 */
export function mergeAndDedupeByLine<T extends BaseSearchResult>(
  resultArrays: ScoredResult<T>[][],
  maxResults: number
): ScoredResult<T>[] {
  const allResults = resultArrays.flat()
  allResults.sort((a, b) => b.score - a.score)

  const seenKeys = new Set<string>()
  const deduped: ScoredResult<T>[] = []

  for (const result of allResults) {
    const key = `${result.path}:${result.lineNumber}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      deduped.push(result)
    }
    if (deduped.length >= maxResults) break
  }

  return deduped
}

