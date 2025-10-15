import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace } from '../utils'
import fs from 'node:fs/promises'

export const copyTool: AgentTool = {
  name: 'fs.copy',
  description: 'Copy a file or directory within the workspace',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source workspace-relative path' },
      to: { type: 'string', description: 'Destination workspace-relative path' },
      recursive: { type: 'boolean', default: true },
      overwrite: { type: 'boolean', default: true },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  run: async ({ from, to, recursive = true, overwrite = true }: { from: string; to: string; recursive?: boolean; overwrite?: boolean }) => {
    const src = resolveWithinWorkspace(from)
    const dst = resolveWithinWorkspace(to)
    // Prefer fs.cp if available (Node 16.7+)
    const anyFs: any = fs as any
    if (overwrite) {
      try { await fs.rm(dst, { recursive: true, force: true }) } catch {}
    }
    if (typeof anyFs.cp === 'function') {
      await anyFs.cp(src, dst, { recursive, force: true })
    } else {
      // Fallback: try copyFile (files only)
      await fs.copyFile(src, dst)
    }
    return { ok: true }
  },
}

