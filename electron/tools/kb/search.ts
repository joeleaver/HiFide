import type { AgentTool } from '../../providers/provider'
import { search as kbSearch } from '../../store/utils/knowledgeBase'
import { randomUUID } from 'node:crypto'

export const knowledgeBaseSearchTool: AgentTool = {
  name: 'knowledgeBaseSearch',
  description: 'Search the project Knowledge Base for documentation. Multi-word queries fall back to tokenized ranking across titles, tags, files, and body content. If information is missing, create or update entries with knowledgeBaseStore instead of writing files.',
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

    return {
      ok: true,
      data: {
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          tags: r.tags,
          files: (r as any).files || [],
          path: r.relPath.replace(/^\\?/, ''),
          excerpt: r.excerpt,
          score: typeof r.score === 'number' ? r.score : 1,
        }))
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

