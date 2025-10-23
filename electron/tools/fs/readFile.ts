/**
 * fs.read_file tool
 *
 * Read a UTF-8 text file from the workspace.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const readFileTool: AgentTool = {
  name: 'fs.read_file',
  description: 'Read a UTF-8 text file from the workspace',
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
      return { ok: true, content }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

