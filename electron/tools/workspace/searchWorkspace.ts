import type { AgentTool } from '../../providers/provider'
import { grepTool } from '../text/grep'
import { randomUUID } from 'node:crypto'

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

export const searchWorkspaceTool: AgentTool = {
  name: 'workspaceSearch',
  description: 'Search workspace code using ripgrep. Returns file paths and line numbers where the search pattern is found. Use literal text or regex patterns.',
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

    const matches = grepResult.data?.matches || []
    const results: SearchWorkspaceResult[] = matches.map((m: any) => ({
      path: m.file,
      lineNumber: m.lineNumber,
      line: m.line
    }))

    const elapsedMs = Date.now() - t0
    const summary = results.length > 0
      ? `Found ${results.length} match${results.length === 1 ? '' : 'es'} in ${new Set(results.map(r => r.path)).size} file(s)`
      : 'No matches found'

    return {
      ok: true,
      data: {
        results,
        count: results.length,
        summary,
        meta: {
          elapsedMs,
          filesMatched: new Set(results.map(r => r.path)).size,
          truncated: grepResult.data?.summary?.truncated || false
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
          previewKey,
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

