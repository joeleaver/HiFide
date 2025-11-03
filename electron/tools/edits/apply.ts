import type { AgentTool } from '../../providers/provider'
import { applyLineRangeEditsInternal } from '../utils'
import { randomUUID } from 'node:crypto'


export const applyEditsTool: AgentTool = {
  name: 'applyEdits',
  description: 'Apply sequential, line-based edits to a single file. Provide 1-based startLine/endLine ranges in ascending order; tool normalizes line endings automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace' },
      edits: {
        type: 'array',
        description: 'Sequential line ranges to replace (1-based, inclusive)',
        items: {
          type: 'object',
          properties: {
            startLine: { type: 'integer' },
            endLine: { type: 'integer' },
            newText: { type: 'string' },
          },
          required: ['startLine', 'endLine', 'newText'],
        },
      },
    },
    required: ['path', 'edits'],
  },
  run: async ({ path, edits, dryRun }: { path: string; edits: Array<{ startLine: number; endLine: number; newText: string }>; dryRun?: boolean }) => {
    return await applyLineRangeEditsInternal(path, edits, { dryRun })
  },
  toModelResult: (raw: any) => {
    if (raw?.fileEditsPreview && Array.isArray(raw.fileEditsPreview)) {
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: !!raw.ok,
          applied: raw.applied ?? 0,
          results: Array.isArray(raw.results) ? raw.results : [],
          previewKey,
          previewCount: raw.fileEditsPreview.length
        },
        ui: raw.fileEditsPreview,
        previewKey
      }
    }
    return { minimal: raw }
  },
}

