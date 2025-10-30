import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const createDirTool: AgentTool = {
  name: 'fsCreateDir',
  description: 'Create a directory inside the workspace (recursive by default)',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory path' },
      recursive: { type: 'boolean', default: true },
    },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel, recursive = true }: { path: string; recursive?: boolean }) => {
    const abs = resolveWithinWorkspace(rel)
    await fs.mkdir(abs, { recursive })
    return { ok: true }
  },
}

