/**
 * fs.read_file tool
 *
 * Read a UTF-8 text file from the workspace.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const readFileTool: AgentTool = {
  name: 'fsReadFile',
  description: 'Read a UTF-8 text file. Prefer workspaceSearch + fsReadLines for targeted reads; avoid bulk file reads without a concrete change plan.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path' } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async ({ path: rel }: { path: string }) => {
    try {
      const abs = resolveWithinWorkspace(rel)
      const content = await fs.readFile(abs, 'utf-8')
      // Always return raw text
      return content
    } catch (e: any) {
      // Return error as plain string for consistency
      return `Error: ${e?.message || String(e)}`
    }
  },
}

