import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const deleteFileTool: AgentTool = {
  name: 'fsDeleteFile',
  description: 'Delete a file from the workspace. If force=true, succeeds when the file is missing.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path' },
      force: { type: 'boolean', default: true },
    },
    required: ['path'],
    additionalProperties: false,
  },
  run: async (input: any, meta?: any) => {
    const rel = input?.path
    const force: boolean = typeof input?.force === 'boolean' ? input.force : true

    if (!rel || typeof rel !== 'string' || !rel.trim()) {
      throw new Error('fsDeleteFile: missing required parameter "path" (workspace-relative file path)')
    }

    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
    try {
      await fs.unlink(abs)
    } catch (e: any) {
      if (!force) throw e
    }

    return { ok: true, path: rel }
  },
}

