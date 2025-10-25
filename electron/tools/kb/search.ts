import type { AgentTool } from '../../providers/provider'
import { useMainStore } from '../../store'
import { search as kbSearch, type KbHit } from '../../store/utils/knowledgeBase'

export const knowledgeBaseSearchTool: AgentTool = {
  name: 'knowledgeBaseSearch',
  description: 'Search the project Knowledge Base (single source of truth for documentation). Use this to retrieve and reference docs. If information is missing, prefer creating or updating an entry with knowledgeBaseStore instead of writing files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text matched against title, tags, markdown body, and related file paths. Optional.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter results to entries containing ALL these tags (case-insensitive).' },
      limit: { type: 'number', description: 'Maximum number of results to return (default 50).' }
    },
  },
  run: async (input: any) => {
    const baseDir = useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    const query = typeof input?.query === 'string' ? input.query : ''
    const tags = Array.isArray(input?.tags) ? input.tags : []
    const limit = typeof input?.limit === 'number' ? input.limit : 50

    const results: KbHit[] = await kbSearch(baseDir, { query, tags, limit })

    return {
      ok: true,
      data: {
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          tags: r.tags,
          files: (r as any).files || [],
          path: r.relPath.replace(/^\\\\?/, ''),
          excerpt: r.excerpt,
          score: r.score ?? 1,
        }))
      }
    }
  }
}

