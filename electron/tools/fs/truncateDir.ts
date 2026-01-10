import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'
import path from 'node:path'

export const truncateDirTool: AgentTool = {
  name: 'fsTruncateDir',
  description: 'Empty a directory.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  run: async ({ path: rel, ensureExists = true }: { path: string; ensureExists?: boolean }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
    if (ensureExists) {
      await fs.mkdir(abs, { recursive: true })
    }
    const entries = await fs.readdir(abs, { withFileTypes: true })
    await Promise.all(entries.map(async (e) => {
      const child = path.join(abs, e.name)
      await fs.rm(child, { recursive: true, force: true })
    }))
    return { ok: true }
  },
}

