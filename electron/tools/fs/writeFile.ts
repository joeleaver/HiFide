/**
 * fs.write_file tool
 * 
 * Write a UTF-8 text file atomically inside the workspace.
 */

import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, atomicWrite } from '../utils'

export const writeFileTool: AgentTool = {
  name: 'fs.write_file',
  description: 'Write a UTF-8 text file atomically inside the workspace',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  run: async ({ path: rel, content }: { path: string; content: string }) => {
    const abs = resolveWithinWorkspace(rel)
    await atomicWrite(abs, content)
    return { ok: true }
  },
}

