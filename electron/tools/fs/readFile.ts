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
  description: 'Read a UTF-8 text file and return its raw content. Prefer workspaceSearch + fsReadLines for targeted reads; avoid bulk file reads without a concrete change plan.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path' }, normalizeEol: { type: 'boolean', default: true } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async (input: { path: string; normalizeEol?: boolean }, meta?: any) => {
    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, input.path) : resolveWithinWorkspace(input.path)
    try {
      const content = await fs.readFile(abs, 'utf-8')
      const normalize = input?.normalizeEol !== false
      const text = normalize ? content.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : content
      // Return raw text per project preference: no JSON wrapping
      return text
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e)
      throw new Error(`fsReadFile: ${msg}`)
    }
  },
}

