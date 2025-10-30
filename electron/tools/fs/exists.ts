import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const existsTool: AgentTool = {
  name: 'fsExists',
  description: 'Check if a workspace-relative path exists',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path' } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel }: { path: string }) => {
    const abs = resolveWithinWorkspace(rel)
    try { await fs.access(abs); return { ok: true, exists: true } } catch { return { ok: true, exists: false } }
  },
}

