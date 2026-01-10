import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const truncateFileTool: AgentTool = {
  name: 'fsTruncateFile',
  description: 'Truncate a file to zero length.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  run: async ({ path: rel, create = true }: { path: string; create?: boolean }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
    if (create) {
      await fs.writeFile(abs, '', 'utf-8')
    } else {
      await fs.truncate(abs, 0)
    }
    return { ok: true }
  },
}

