/**
 * fs.read_dir tool
 *
 * List directory entries (name, isDirectory, path).
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'
import path from 'node:path'

export const readDirTool: AgentTool = {
  name: 'fsReadDir',
  description: 'List directory entries (name, isDirectory, path). Use for quick structure checks; to locate code, prefer workspaceSearch.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path' } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel }: { path: string }) => {
    try {
      const abs = resolveWithinWorkspace(rel)
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

