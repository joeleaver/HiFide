import type { AgentTool } from '../../providers/provider'
import { applyFileEditsInternal } from '../utils'

export const applyEditsTool: AgentTool = {
  name: 'edits.apply',
  description: 'Apply a list of precise edits (verify with TypeScript when possible)',
  parameters: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
              required: ['type', 'path', 'oldText', 'newText'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
              required: ['type', 'path', 'line', 'text'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
              required: ['type', 'path', 'start', 'end', 'text'],
              additionalProperties: false,
            },
          ],
        },
      },
      verify: { type: 'boolean', default: true },
      tsconfigPath: { type: 'string' },
    },
    required: ['edits'],
    additionalProperties: false,
  },
  run: async ({ edits, verify = true, tsconfigPath }: { edits: any[]; verify?: boolean; tsconfigPath?: string }) => {
    const res = await applyFileEditsInternal(edits, { verify, tsconfigPath })
    return res
  },
}

