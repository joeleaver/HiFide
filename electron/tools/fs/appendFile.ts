import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot } from '../utils'
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
  run: async (input: any, meta?: any) => {
    const rel = input?.path
    const content = input?.content

    // Validate parameters explicitly so missing args produce a clear tool_error
    if (!rel || typeof rel !== 'string' || !rel.trim()) {
      throw new Error('fsAppendFile: missing required parameter "path" (workspace-relative file path)')
    }
    if (typeof content === 'undefined') {
      throw new Error('fsAppendFile: missing required parameter "content" (string)')
    }
    if (typeof content !== 'string') {
      throw new Error('fsAppendFile: invalid parameter "content" (must be a string)')
    }

    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)

    // Capture previous contents (if any) to provide a diff preview to the UI
    let before = ''
    try {
      before = await fs.readFile(abs, 'utf-8')
    } catch {}

    await fs.appendFile(abs, content, 'utf-8')

    const after = before + content

    return {
      ok: true,
      path: rel,
      fileEditsPreview: [
        { path: rel, before, after }
      ]
    }
  },
}

