import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
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
  run: async ({ path: rel, force = true }: { path: string; force?: boolean }) => {
    const abs = resolveWithinWorkspace(rel)
    try { await fs.unlink(abs) } catch (e: any) {
      if (!force) throw e
    }
    return { ok: true }
  },
}

