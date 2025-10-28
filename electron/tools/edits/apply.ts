import type { AgentTool } from '../../providers/provider'
import { applyFileEditsInternal } from '../utils'

export const applyEditsTool: AgentTool = {
  name: 'edits.apply',
  description: 'Apply a list of precise edits to files. Use this when you know exactly what to change. Prefer small, surgical diffs. If uncertain, consider code.apply_edits_targeted with a dry-run preview first.',
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
}

