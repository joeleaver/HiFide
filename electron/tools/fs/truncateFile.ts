import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const truncateFileTool: AgentTool = {
  name: 'fsTruncateFile',
  description: 'Truncate a file to zero length (optionally create if missing).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path' },
      create: { type: 'boolean', default: true },
    },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel, create = true }: { path: string; create?: boolean }) => {
    const abs = resolveWithinWorkspace(rel)
    if (create) {
      await fs.writeFile(abs, '', 'utf-8')
    } else {
      await fs.truncate(abs, 0)
    }
    return { ok: true }
  },
}

