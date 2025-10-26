import type { AgentTool } from '../../providers/provider'
import { applyFileEditsInternal } from '../utils'

export const applyEditsTool: AgentTool = {
  name: 'edits.apply',
  description: 'Apply a list of precise edits to files. Use this when you know exactly what to change. Prefer small, surgical diffs. If uncertain, use code.apply_edits_targeted with dryRun first, then apply for real with verify enabled.',
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
      verify: { type: 'boolean', default: true, description: 'Run TypeScript verification after edits' },
      tsconfigPath: { type: 'string', description: 'Path to tsconfig.json for verification' },
    },
    required: ['edits'],
  },
  run: async ({ edits, verify = true, tsconfigPath }: { edits: any[]; verify?: boolean; tsconfigPath?: string }) => {
    const res = await applyFileEditsInternal(edits, { verify, tsconfigPath })
    return res
  },
}

