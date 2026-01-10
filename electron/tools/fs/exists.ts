import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const existsTool: AgentTool = {
  name: 'fsExists',
  description: 'Check if a path exists.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  run: async ({ path: rel }: { path: string }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
    try { await fs.access(abs); return { ok: true, exists: true } } catch { return { ok: true, exists: false } }
  },
}

