import type { AgentTool } from '../../providers/provider'
import { randomUUID } from 'node:crypto'
import { getGlobalIndexingOrchestratorService, getWorkspaceService } from '../../services/index.js'
import {
  type ScoredResult,
  type SearchWorkspaceResult,
  mergeAndDedupeResults,
  tokenizeQuery,
  runFilenameSearch,
  runScoredGrepSearch,
  runScoredTokenizedSearch,
  runScoredPathSearch,
  runScoredSemanticSearch
} from '../search'

/**
 * Intelligent workspace search tool that adapts based on indexing status.
 * Uses unified scoring and ranking across all search strategies.
 */

interface IndexingStatus {
  enabled: boolean
  percentComplete: number
  isProcessing: boolean
}

/**
 * Get current indexing status from the orchestrator
 */
function getIndexingStatus(meta?: any): IndexingStatus {
  try {
    const orchestrator = getGlobalIndexingOrchestratorService()
    if (!orchestrator) {
      return { enabled: false, percentComplete: 0, isProcessing: false }
    }

    // Get workspace ID from metadata or current workspace
    let workspaceId = meta?.workspaceId || meta?.workspaceRoot
    if (!workspaceId) {
      const workspaceService = getWorkspaceService()
      const workspaces = workspaceService.getAllWindowWorkspaces()
      workspaceId = Object.values(workspaces)[0]
    }

    if (!workspaceId) {
      return { enabled: false, percentComplete: 0, isProcessing: false }
    }

    const manager = orchestrator.getWorkspaceManager(workspaceId)
    if (!manager) {
      return { enabled: false, percentComplete: 0, isProcessing: false }
    }

    const state = manager.getState()
    const enabled = state.indexingEnabled ?? false
    const total = state.code?.total || 0
    const indexed = state.code?.indexed || 0
    const percentComplete = total > 0 ? Math.round((indexed / total) * 100) : 0
    const isProcessing = state.status === 'indexing'

    return { enabled, percentComplete, isProcessing }
  } catch {
    return { enabled: false, percentComplete: 0, isProcessing: false }
  }
}

/**
 * Generate dynamic tool description based on indexing status
 */
function getToolDescription(): string {
  return 'Search workspace files and content.'
}

export interface SearchWorkspaceParams {
  query: string
  filters?: {
    pathsInclude?: string[]
    pathsExclude?: string[]
    maxResults?: number
  }
}

// Re-export types from the shared search module for backwards compatibility
export { type SearchWorkspaceResult, type ScoredResult } from '../search'

export const searchWorkspaceTool: AgentTool = {
  name: 'workspaceSearch',
  // Dynamic description based on indexing status
  get description() {
    return getToolDescription()
  },
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      filters: {
        type: 'object',
        properties: {
          pathsInclude: { type: 'array', items: { type: 'string' } },
          pathsExclude: { type: 'array', items: { type: 'string' } },
          maxResults: { type: 'integer' }
        }
      }
    },
    required: ['query'],
  },

  run: async (args: SearchWorkspaceParams, meta?: any): Promise<any> => {
    const t0 = Date.now()

    if (!args.query || !args.query.trim()) {
      return { ok: false, error: 'query is required' }
    }

    const query = args.query.trim()
    const maxResults = args.filters?.maxResults ?? 10
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

    // Get indexing status to determine if semantic search should be included
    const indexingStatus = getIndexingStatus(meta)
    const { enabled: indexingEnabled, percentComplete } = indexingStatus
    const tokens = tokenizeQuery(query)

    // ==========================================================================
    // UNIFIED SEARCH STRATEGY
    //
    // Always run: filename + grep + tokenized + path searches
    // If indexing enabled: also run semantic search and interleave by score
    // ==========================================================================

    // Collect all search results in parallel
    const searchPromises: Promise<ScoredResult[]>[] = [
      // 1. Filename search (highest priority)
      runFilenameSearch({ query, include, exclude, maxResults, meta }),

      // 2. Grep search with scoring
      runScoredGrepSearch({ query, include, exclude, maxResults, meta }),

      // 3. Path search
      runScoredPathSearch({ query, tokens, include, exclude, maxResults, meta }),

      // 4. Tokenized search (only if multi-token query)
      tokens.length >= 2
        ? runScoredTokenizedSearch({ tokens, include, exclude, maxResults, meta })
        : Promise.resolve([])
    ]

    // 5. Semantic search (only if indexing is enabled)
    if (indexingEnabled) {
      searchPromises.push(runScoredSemanticSearch({ query, maxResults, meta }))
    }

    // Wait for all searches to complete
    const allResultArrays = await Promise.all(searchPromises)

    // Merge and dedupe all results by score
    const merged = mergeAndDedupeResults(allResultArrays, maxResults)

    if (merged.length === 0) {
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
            mode: 'none',
            indexingStatus: indexingEnabled ? `${percentComplete}%` : 'disabled'
          }
        }
      }
    }

    // Determine which sources contributed
    const sources = new Set(merged.map(r => r.source))
    const sourceList = Array.from(sources).join('+')

    // Convert ScoredResults back to SearchWorkspaceResult for output
    const results: SearchWorkspaceResult[] = merged.map(r => ({
      path: r.path,
      lineNumber: r.lineNumber,
      line: r.line
    }))

    const filesMatched = new Set(results.map(r => r.path)).size
    const indexStatusStr = indexingEnabled ? `index ${percentComplete}%` : 'indexing disabled'

    return {
      ok: true,
      data: {
        results,
        count: results.length,
        summary: `Found ${results.length} match(es) in ${filesMatched} file(s) [${sourceList}] (${indexStatusStr})`,
        meta: {
          elapsedMs: Date.now() - t0,
          filesMatched,
          truncated: allResultArrays.some(arr => arr.length >= maxResults),
          mode: sources.size > 1 ? 'combined' : (sources.values().next().value || 'none'),
          sources: Array.from(sources),
          indexingStatus: indexingEnabled ? `${percentComplete}%` : 'disabled'
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

