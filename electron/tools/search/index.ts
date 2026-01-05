/**
 * Shared search utilities and strategies.
 * Re-exports scoring utilities and workspace search strategies.
 */

// Scoring utilities
export {
  type BaseSearchResult,
  type SearchSource,
  type ScoredResult,
  SCORE_FILENAME_EXACT,
  SCORE_FILENAME_PARTIAL,
  SCORE_SEMANTIC_MIN_THRESHOLD,
  SCORE_GREP_BASE,
  SCORE_GREP_POSITION_BONUS,
  SCORE_GREP_PATH_BONUS,
  SCORE_GREP_DENSITY_BONUS,
  SCORE_TOKENIZED_BASE,
  SCORE_PATH_BASE,
  calculateGrepScore,
  getPathDepth,
  calculatePositionScore,
  mergeAndDedupeResults,
  mergeAndDedupeByLine
} from './scoring'

// Workspace search strategies
export {
  type SearchWorkspaceResult,
  type WorkspaceSearchParams,
  type TokenSearchParams,
  PATH_MATCH_LINE,
  FILENAME_MATCH_LINE,
  tokenizeQuery,
  countOccurrences,
  runFilenameSearch,
  runScoredGrepSearch,
  runScoredTokenizedSearch,
  runScoredPathSearch,
  runScoredSemanticSearch
} from './workspaceStrategies'

