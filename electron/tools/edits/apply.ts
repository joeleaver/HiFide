import type { AgentTool } from '../../providers/provider'
import { applyFileEditsInternal } from '../utils'
import { randomUUID } from 'node:crypto'


export const applyEditsTool: AgentTool = {
  name: 'applyEdits',
  description: 'Apply precise text edits to files. Use when you know the exact change; keep diffs small. If uncertain, try codeApplyEditsTargeted with dryRun first.',
  parameters: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'List of edits to apply',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['replaceOnce', 'insertAfterLine', 'replaceRange'], description: 'Type of edit' },
            path: { type: 'string', description: 'File path relative to workspace' },
            // For replaceOnce
            oldText: { type: 'string', description: 'Text to find and replace (for replaceOnce)' },
            newText: { type: 'string', description: 'Replacement text (for replaceOnce)' },
            // For insertAfterLine
            line: { type: 'integer', description: 'Line number to insert after (for insertAfterLine)' },
            text: { type: 'string', description: 'Text to insert (for insertAfterLine or replaceRange)' },
            // For replaceRange
            start: { type: 'integer', description: 'Start character offset (for replaceRange)' },
            end: { type: 'integer', description: 'End character offset (for replaceRange)' },
          },
          required: ['type', 'path']
        },
      },
    },
    required: ['edits'],
  },
  run: async ({ edits }: { edits: any[] }) => {
    return await applyFileEditsInternal(edits, {})
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

