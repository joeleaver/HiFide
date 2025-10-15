import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const statTool: AgentTool = {
  name: 'fs.stat',
  description: 'Get basic stat info for a workspace-relative path',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path' } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel }: { path: string }) => {
    const abs = resolveWithinWorkspace(rel)
    const s = await fs.stat(abs)
    return { ok: true, isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }
  },
}

