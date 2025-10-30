import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const appendFileTool: AgentTool = {
  name: 'fsAppendFile',
  description: 'Append UTF-8 text to a file in the workspace (creates file if missing)',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path' },
      content: { type: 'string', description: 'Text to append' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  run: async ({ path: rel, content }: { path: string; content: string }) => {
    const abs = resolveWithinWorkspace(rel)
    await fs.appendFile(abs, content, 'utf-8')
    return { ok: true }
  },
}

