import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const copyTool: AgentTool = {
  name: 'fsCopy',
  description: 'Copy a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['from', 'to'],
  },
  run: async ({ from, to, recursive = true, overwrite = true }: { from: string; to: string; recursive?: boolean; overwrite?: boolean }, meta?: any) => {
    const src = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, from) : resolveWithinWorkspace(from)
    const dst = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, to) : resolveWithinWorkspace(to)
    // Prefer fs.cp if available (Node 16.7+)
    const anyFs: any = fs as any
    if (overwrite) {
      try { await fs.rm(dst, { recursive: true, force: true }) } catch {}
    }
    if (typeof anyFs.cp === 'function') {
      await anyFs.cp(src, dst, { recursive, force: true })
    } else {
      // Fallback: try copyFile (files only)
      await fs.copyFile(src, dst)
    }
    return { ok: true }
  },
}

