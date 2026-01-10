/**
 * fs.write_file tool
 *
 * Write a UTF-8 text file atomically inside the workspace.
 */

import fs from 'node:fs/promises'
import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, resolveWithinWorkspaceWithRoot, atomicWrite } from '../utils'

export const writeFileTool: AgentTool = {
  name: 'fsWriteFile',
  description: 'Write a file in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  run: async (input: any, meta?: any) => {
    const rel = input?.path
    const content = input?.content

    // Validate parameters explicitly so missing args produce a clear tool_error
    if (!rel || typeof rel !== 'string' || !rel.trim()) {
      throw new Error('fsWriteFile: missing required parameter "path" (workspace-relative file path)')
    }
    if (typeof content === 'undefined') {
      throw new Error('fsWriteFile: missing required parameter "content" (string)')
    }
    if (typeof content !== 'string') {
      throw new Error('fsWriteFile: invalid parameter "content" (must be a string)')
    }

    const abs = meta?.workspaceId ? resolveWithinWorkspaceWithRoot(meta.workspaceId, rel) : resolveWithinWorkspace(rel)

    // Helper: detect dominant EOL style in a string
    const detectEol = (s: string): string => {
      const crlf = (s.match(/\r\n/g) || []).length
      const totalLF = (s.split('\n').length - 1)
      const lfOnly = totalLF - crlf
      return crlf > lfOnly ? '\r\n' : '\n'
    }
    const toLF = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const fromLF = (s: string, eol: string): string => s.replace(/\n/g, eol)

    // Sanitize obvious chat wrappers / tool-call leakage similar to edits.apply
    const sanitize = (s: string): string => {
      let out = s
      const fenceStart = out.match(/^```[a-zA-Z0-9._-]*\s/)
      if (fenceStart) {
        out = out.replace(/^```[a-zA-Z0-9._-]*\s/, '')
        out = out.replace(/```\s*$/, '')
      }
      out = out.replace(/\n?[^\n]*to=functions\.[A-Za-z0-9_.-]+[\s\S]*$/m, '')
      out = out.replace(/^\s*(Sure, here(?:'|)s|Here(?:'|)s|Okay,|Alright,)[^\n]*\n/, '')
      out = out.replace(/```+\s*$/g, '')
      return out
    }

    // Read existing file to preserve its EOL style when present
    let before = ''
    try {
      before = await fs.readFile(abs, 'utf-8')
    } catch {}

    const targetEol = before ? detectEol(before) : '\n'
    const sanitized = sanitize(content)
    const normalized = fromLF(toLF(sanitized), targetEol)

    await atomicWrite(abs, normalized)

    // Return minimal success plus a single-file preview for inline diff UI and filename header
    return {
      ok: true,
      path: rel,
      fileEditsPreview: [
        {
          path: rel,
          before,
          after: normalized,
        }
      ]
    }
  },
}

