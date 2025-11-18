import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const moveTool: AgentTool = {
  name: 'fsMove',
  description: 'Move/rename a file or directory within the workspace',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source workspace-relative path' },
      to: { type: 'string', description: 'Destination workspace-relative path' },
      overwrite: { type: 'boolean', default: true },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  run: async ({ from, to, overwrite = true }: { from: string; to: string; overwrite?: boolean }, meta?: any) => {
    const src = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, from) : resolveWithinWorkspace(from)
    const dst = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, to) : resolveWithinWorkspace(to)
    if (overwrite) {
      try { await fs.rm(dst, { recursive: true, force: true }) } catch {}
    }
    await fs.rename(src, dst)
    return { ok: true }
  },
}

