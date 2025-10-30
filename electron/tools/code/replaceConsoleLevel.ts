import type { AgentTool } from '../../providers/provider'
import { astGrepRewrite } from '../astGrep'

/**
 * High-level wrapper: change console.* level while preserving arguments.
 */
export const replaceConsoleLevelTool: AgentTool = {
  name: 'codeReplaceConsoleLevel',
  description: 'Change console.<level>(...) to another level while preserving arguments. Use for logging hygiene; for general call renames use codeReplaceCall.',
  parameters: {
    type: 'object',
    properties: {
      fromLevel: { type: 'string', enum: ['log','debug','info','warn','error','trace'], description: 'Original console level' },
      toLevel: { type: 'string', enum: ['log','debug','info','warn','error','trace'], description: 'Target console level' },
      languages: { type: 'array', items: { type: 'string' }, description: "Optional languages; default 'auto'" },
      includeGlobs: { type: 'array', items: { type: 'string' } },
      excludeGlobs: { type: 'array', items: { type: 'string' } },
      perFileLimit: { type: 'integer', minimum: 1, maximum: 1000 },
      totalLimit: { type: 'integer', minimum: 1, maximum: 10000 },
      maxFileBytes: { type: 'integer', minimum: 1 },
      concurrency: { type: 'integer', minimum: 1, maximum: 32 },
      dryRun: { type: 'boolean' },
      rangesOnly: { type: 'boolean' }
    },
    required: ['fromLevel', 'toLevel'],
    additionalProperties: false
  },
  run: async (input: {
    fromLevel: 'log'|'debug'|'info'|'warn'|'error'|'trace'
    toLevel: 'log'|'debug'|'info'|'warn'|'error'|'trace'
    languages?: string[] | 'auto'
    includeGlobs?: string[]
    excludeGlobs?: string[]
    perFileLimit?: number
    totalLimit?: number
    maxFileBytes?: number
    concurrency?: number
    dryRun?: boolean
    rangesOnly?: boolean
  }) => {
    if (input.fromLevel === input.toLevel) return { ok: true, changes: [], stats: { scannedFiles: 0, matchedCount: 0, changedFiles: 0, durationMs: 0 }, truncated: false }

    const pattern = `console.${input.fromLevel}($$ARGS)`
    const rewrite = `console.${input.toLevel}($$ARGS)`

    try {
      const res = await astGrepRewrite({
        pattern,
        rewrite,
        languages: input.languages && input.languages.length ? input.languages : 'auto',
        includeGlobs: input.includeGlobs,
        excludeGlobs: input.excludeGlobs,
        perFileLimit: input.perFileLimit,
        totalLimit: input.totalLimit,
        maxFileBytes: input.maxFileBytes,
        concurrency: input.concurrency,
        dryRun: input.dryRun,
        rangesOnly: input.rangesOnly
      })
      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

export default replaceConsoleLevelTool

