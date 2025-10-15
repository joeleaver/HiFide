import type { AgentTool } from '../../providers/provider'
import { astGrepSearch } from '../astGrep'

export const searchAstTool: AgentTool = {
  name: 'code.search_ast',
  description: 'Structural AST search using @ast-grep/napi (inline patterns only)',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'ast-grep inline pattern, e.g., console.log($VAL)' },
      languages: { type: 'array', items: { type: 'string' }, description: "Optional languages. Use 'auto' by file extension if omitted" },
      includeGlobs: { type: 'array', items: { type: 'string' } },
      excludeGlobs: { type: 'array', items: { type: 'string' } },
      maxMatches: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
      contextLines: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
      maxFileBytes: { type: 'integer', minimum: 1, default: 1000000 },
      concurrency: { type: 'integer', minimum: 1, maximum: 32, default: 6 },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  run: async (args: { pattern: string; languages?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; maxMatches?: number; contextLines?: number; maxFileBytes?: number; concurrency?: number }) => {
    try {
      const res = await astGrepSearch({
        pattern: args.pattern,
        languages: (args.languages && args.languages.length) ? args.languages : 'auto',
        includeGlobs: args.includeGlobs,
        excludeGlobs: args.excludeGlobs,
        maxMatches: args.maxMatches,
        contextLines: args.contextLines,
        maxFileBytes: args.maxFileBytes,
        concurrency: args.concurrency,
      })
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

