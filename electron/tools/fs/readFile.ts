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
    properties: { path: { type: 'string', description: 'Workspace-relative path' }, normalizeEol: { type: 'boolean', default: true } },
    required: ['path'],
    additionalProperties: false,
  },
  run: async (input: { path: string; normalizeEol?: boolean }) => {
    const abs = resolveWithinWorkspace(input.path)
    try {
      const content = await fs.readFile(abs, 'utf-8')
      const normalize = input?.normalizeEol !== false
      const text = normalize ? content.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : content
      const lineCount = text.split('\n').length
      return {
        path: input.path,
        text,
        lineCount,
        usedParams: { path: input.path, normalizeEol: normalize }
      }
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e)
      throw new Error(`fsReadFile: ${msg}`)
    }
  },
}

