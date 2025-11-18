import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const deleteDirTool: AgentTool = {
  name: 'fsDeleteDir',
  description: 'Delete a directory from the workspace (recursive, force by default). USE WITH CARE.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory path' },
      recursive: { type: 'boolean', default: true },
      force: { type: 'boolean', default: true },
    },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel, recursive = true, force = true }: { path: string; recursive?: boolean; force?: boolean }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
    await fs.rm(abs, { recursive, force })
    return { ok: true }
  },
}

