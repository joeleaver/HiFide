/**
 * fs.read_dir tool
 *
 * List directory entries (name, isDirectory, path).
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'
import path from 'node:path'

export const readDirTool: AgentTool = {
  name: 'fsReadDir',
  description: 'List directory contents.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  run: async ({ path: rel }: { path: string }, meta?: any) => {
    try {
      const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      return {
        ok: true,
        entries: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), path: path.join(rel, e.name) })),
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

