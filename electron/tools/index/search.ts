import type { AgentTool } from '../../providers/provider'
import { getIndexer } from '../../core/state'

export const indexSearchTool: AgentTool = {
  name: 'index.search',
  description: 'Vector search the repository index for relevant code context',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 20 } },
    required: ['query'],
    additionalProperties: false,
  },
  run: async ({ query, k = 8 }: { query: string; k?: number }) => {
    try {
      const res = await getIndexer().search(query.slice(0, 2000), k)
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

