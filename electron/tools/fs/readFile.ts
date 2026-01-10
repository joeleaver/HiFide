/**
 * fs.read_file tool
 *
 * Read a UTF-8 text file from the workspace.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
import fs from 'node:fs/promises'

export const readFileTool: AgentTool = {
  name: 'fsReadFile',
  description: 'Read a file from the workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  run: async (input: { path: string }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, input.path) : resolveWithinWorkspace(input.path)
    try {
      const content = await fs.readFile(abs, 'utf-8')
      const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      return text
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e)
      throw new Error(`fsReadFile: ${msg}`)
    }
  },
}

