import type { AgentTool } from '../../providers/provider'
import { search as kbSearch } from '../../store/utils/knowledgeBase'
import { randomUUID } from 'node:crypto'
import { getVectorService } from '../../services/index.js'
import { resolveWorkspaceRoot } from '../../utils/workspace.js'
import { SCORE_SEMANTIC_MIN_THRESHOLD } from '../search'

/**
 * KB search result with score for unified ranking
 */
export interface KBSearchResult {
  id: string
  title: string
  tags: string[]
  files: string[]
  path: string
  excerpt: string
  score: number
  source?: 'keyword' | 'semantic'
}

/**
 * Run semantic search against KB collection
 * Uses shared semantic threshold filtering
 */
async function runSemanticKBSearch({
  query,
  limit,
  meta
}: {
  query: string
  limit: number
  meta?: any
}): Promise<KBSearchResult[]> {
  try {
    const vectorService = getVectorService()
    const workspaceRoot = resolveWorkspaceRoot(meta?.workspaceId)

    await vectorService.init(workspaceRoot)
    const matches = await vectorService.search(query, limit * 2, 'kb') // Get extra for filtering

    if (!matches || matches.length === 0) return []

    return matches
      .filter((m: any) => (m.score || 0) >= SCORE_SEMANTIC_MIN_THRESHOLD)
      .slice(0, limit)
      .map((m: any) => ({
        id: m.kbId || m.id,
        title: m.articleTitle || m.metadata?.title || 'Untitled',
        tags: m.metadata?.tags || [],
        files: m.metadata?.files || [],
        path: (m.filePath || '').replace(/^\\?/, ''),
        excerpt: `[semantic] (${((m.score || 0) * 100).toFixed(0)}%) ${(m.text || '').substring(0, 150)}...`,
        score: m.score || 0.5,
        source: 'semantic' as const
      }))
  } catch {
    return []
  }
}

export const knowledgeBaseSearchTool: AgentTool = {
  name: 'knowledgeBaseSearch',
  description: 'Search the project Knowledge Base for documentation. This tool uses a multi-stage search: it first performs a keyword/tag match and then falls back to a semantic vector search if results are sparse. Effectively handles natural language questions and multi-word queries. If information is missing, create or update entries with knowledgeBaseStore instead of writing files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text matched against title, tags, markdown body, and related file paths. Optional.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter results to entries containing ALL these tags (case-insensitive).' },
      limit: { type: 'number', description: 'Maximum number of results to return (default 50).' }
    },
  },
  run: async (input: any, meta?: any) => {
    if (!meta?.workspaceId) {
      return { ok: false, error: 'workspaceId required in meta' }
    }
    const baseDir = meta.workspaceId
    const query = typeof input?.query === 'string' ? input.query : ''
    const tags: string[] = Array.isArray(input?.tags) ? (input.tags as any[]).map((t) => String(t).trim()).filter(Boolean) : []
    const limit = typeof input?.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(input.limit))) : 50

    const tagSet = new Set(tags.map((t: string) => t.toLowerCase()))
    const results = await kbSearch(baseDir, { query: query.trim(), tags: Array.from(tagSet), limit })

    // Map keyword results with source tag
    let finalResults: KBSearchResult[] = results.map((r) => ({
      id: r.id,
      title: r.title,
      tags: r.tags,
      files: (r as any).files || [],
      path: r.relPath.replace(/^\\?/, ''),
      excerpt: r.excerpt || '',
      score: typeof r.score === 'number' ? r.score : 1,
      source: 'keyword' as const
    }))

    // If we have a query and few results, try semantic fallback
    if (query.trim() && finalResults.length < limit) {
      const semanticResults = await runSemanticKBSearch({
        query: query.trim(),
        limit: limit - finalResults.length,
        meta
      })

      // Merge and avoid duplicates by ID, sort by score
      const seenIds = new Set(finalResults.map(r => r.id))
      for (const sem of semanticResults) {
        if (!seenIds.has(sem.id)) {
          finalResults.push(sem)
          seenIds.add(sem.id)
        }
      }

      // Re-sort merged results by score descending
      finalResults.sort((a, b) => b.score - a.score)
    }

    // Collect sources for metadata
    const sources = new Set(finalResults.map(r => r.source))

    return {
      ok: true,
      data: {
        count: finalResults.length,
        results: finalResults,
        sources: Array.from(sources)
      }
    }
  },

  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      const resultData = raw.data
      const resultCount = typeof resultData?.count === 'number' ? resultData.count : Array.isArray(resultData?.results) ? resultData.results.length : 0
      const minimalResults = Array.isArray(resultData?.results)
        ? resultData.results.map((r: any) => ({
            id: r.id,
            title: r.title,
            tags: r.tags,
            files: r.files,
            path: r.path,
            excerpt: r.excerpt,
            score: r.score,
          }))
        : []

      return {
        minimal: {
          ok: true,
          count: resultCount,
          resultCount,
          results: minimalResults
        },
        ui: resultData,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

