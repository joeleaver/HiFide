import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import fs from 'node:fs/promises'

import { searchWorkspaceTool } from './searchWorkspace'

function toHandle(pathRel: string, start: number, end: number): string {
  const payload = { t: 'h', p: pathRel.replace(/\\/g, '/'), s: start | 0, e: end | 0 }
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
}

async function getWorkspaceRoot(): Promise<string> {
  try {
    const { useMainStore } = await import('../../store/index')
    const root = (useMainStore as any).getState?.().workspaceRoot
    if (root) return path.resolve(root)
  } catch {}
  return path.resolve(process.env.HIFIDE_WORKSPACE_ROOT || process.cwd())
}

export const jumpWorkspaceTool: AgentTool = {
  name: 'workspaceJump',
  description: 'Jump directly to a file by exact path, fuzzy filename, or natural-language description. If the path exists, returns a handle (and optional preview). Otherwise calls workspaceSearch to pick the best handle; set expand=true to include preview.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Exact path (preferred) or NL description (e.g., "starmap initialization file")' },
      expand: { type: 'boolean', description: 'When true, also return preview content for the best handle (default true)' },
      filters: {
        type: 'object',
        properties: {
          languages: { type: 'array', items: { type: 'string' } },
          pathsInclude: { type: 'array', items: { type: 'string' } },
          pathsExclude: { type: 'array', items: { type: 'string' } },
          maxSnippetLines: { type: 'integer', minimum: 1 },
          timeBudgetMs: { type: 'integer', minimum: 100 }
        },
        additionalProperties: false
      }
    },
    required: ['target'],
    additionalProperties: false
  },

  run: async (args: { target: string; expand?: boolean; filters?: any }) => {
    const expand = args.expand !== false
    const maxSnippet = Math.max(30, args?.filters?.maxSnippetLines ?? 200)
    const t0 = Date.now()

    // 1) Exact path fast-path
    try {
      const root = await getWorkspaceRoot()
      const relLike = String(args.target || '').replace(/\\/g, '/')
      const abs = path.resolve(root, relLike)
      const st = await fs.stat(abs).catch(() => null)
      if (st && st.isFile()) {
        const rel = path.relative(root, abs).replace(/\\/g, '/')
        const handle = toHandle(rel, 1, 1) // start-of-file preview via expand path
        if (!expand) return { ok: true, data: { bestHandle: { handle, path: rel, lines: { start: 1, end: 1 } } } }
        const exp = await searchWorkspaceTool.run({ action: 'expand', handle, filters: { maxSnippetLines: maxSnippet } })
        const elapsedMs = Date.now() - t0
        if (exp?.ok) {
          return { ok: true, data: { ...exp.data, bestHandle: { handle, path: rel, lines: (exp as any).data?.lines }, topHandles: [], meta: { elapsedMs, source: 'path' } } }
        }
        return { ok: true, data: { bestHandle: { handle, path: rel, lines: { start: 1, end: 1 } }, meta: { elapsedMs, source: 'path' } } }
      }
    } catch {}

    // 2) Discovery fallback via workspace.search
    const sr: any = await searchWorkspaceTool.run({ query: args.target, filters: args?.filters })
    if (!sr?.ok) return sr
    const best = sr?.data?.bestHandle
    const top = sr?.data?.topHandles || []
    if (!best) return { ok: false, error: 'No match found' }

    if (!expand) return { ok: true, data: { bestHandle: best, topHandles: top } }

    const exp: any = await searchWorkspaceTool.run({ action: 'expand', handle: best.handle, filters: { maxSnippetLines: maxSnippet } })
    if (!exp?.ok) return { ok: true, data: { bestHandle: best, topHandles: top } }
    const elapsedMs = Date.now() - t0
    return { ok: true, data: { ...exp.data, bestHandle: best, topHandles: top, meta: { ...(exp.data?.meta || {}), elapsedMs, source: 'search' } } }
  }
}

export default jumpWorkspaceTool

