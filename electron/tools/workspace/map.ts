import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import fs from 'node:fs/promises'
import fg from 'fast-glob'

async function getWorkspaceRoot(): Promise<string> {
  try {
    const { useMainStore } = await import('../../store/index')
    const root = (useMainStore as any).getState?.().workspaceRoot
    if (root) return path.resolve(root)
  } catch {}
  return path.resolve(process.env.HIFIDE_WORKSPACE_ROOT || process.cwd())
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)) }

async function safeStat(file: string): Promise<{ bytes: number; mtimeMs: number }> {
  try { const s = await fs.stat(file); return { bytes: s.size || 0, mtimeMs: (s.mtimeMs as number) || 0 } } catch { return { bytes: 0, mtimeMs: 0 } }
}

function toHandle(pathRel: string, start: number, end: number): string {
  const payload = { t: 'h', p: pathRel.replace(/\\/g, '/'), s: start | 0, e: end | 0 }
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
}

async function listFiles(root: string, patterns: string[], ignore: string[]): Promise<string[]> {
  try {
    const hits = await fg(patterns, { cwd: root, onlyFiles: true, dot: false, ignore })
    return hits.map((p) => p.replace(/\\/g, '/'))
  } catch { return [] }
}

export const workspaceMapTool: AgentTool = {
  name: 'workspace.map',
  description: 'Return a compact project map: core directories, key files, and curated example queries to accelerate discovery. Purely heuristic; does no heavy indexing.',
  parameters: {
    type: 'object',
    properties: {
      maxPerSection: { type: 'integer', minimum: 1, description: 'Cap per section (default 12)' }
    },
    additionalProperties: false
  },
  run: async ({ maxPerSection = 12 }: { maxPerSection?: number } = {}) => {
    const root = await getWorkspaceRoot()

    // Common ignores (align roughly with searchWorkspace)
    const IGN = [
      'node_modules/**','vendor/**','target/**','dist/**','build/**','out/**','dist-electron/**','release/**',
      '.git/**','.hifide-private/**','.hifide-public/**','.hifide_public/**','.next/**','.nuxt/**','.svelte-kit/**','.expo/**','.vercel/**',
      '.cache/**','.parcel-cache/**','.rollup.cache/**','.turbo/**','.yarn/**','.pnpm-store/**','.idea/**','.vscode/**'
    ]

    const sections: Array<{ title: string; items: Array<{ path: string; why?: string }> }> = []

    // Core directories
    const coreDirs: Array<{ title: string; dir: string; why: string }> = [
      { title: 'Renderer (src)', dir: 'src', why: 'UI and application logic (renderer process)' },
      { title: 'Main (electron)', dir: 'electron', why: 'Electron main process, IPC, providers, tools' },
      { title: 'Packages (optional)', dir: 'packages', why: 'Monorepo packages (if present)' }
    ]
    for (const d of coreDirs) {
      const abs = path.join(root, d.dir)
      const s = await safeStat(abs).catch(() => ({ bytes: 0, mtimeMs: 0 }))
      if (s.bytes === 0) continue
      const files = await listFiles(root, [d.dir + '/**/*.{ts,tsx,js,jsx,json}'], IGN)
      const top = files.slice(0, Math.min(maxPerSection, files.length)).map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } }))
      sections.push({ title: d.title, items: top.length ? top : [{ path: d.dir + '/', why: d.why }] })
    }

    // Key Electron files
    const electronFiles = uniq([
      'electron/main.ts','electron/core/app.ts','electron/core/window.ts',
      'electron/store/index.ts','electron/tools/index.ts',
      'electron/ipc/registry.ts','electron/ipc/pty.ts',
      'electron/providers/openai.ts','electron/providers/anthropic.ts','electron/providers/gemini.ts'
    ])
    const electronExisting = (await Promise.all(electronFiles.map(async (p) => {
      const abs = path.join(root, p)
      const s = await safeStat(abs); if (s.bytes > 0) return p; return ''
    }))).filter(Boolean) as string[]
    if (electronExisting.length) sections.push({ title: 'Key Electron files', items: electronExisting.slice(0, maxPerSection).map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } })) })

    // Key Renderer files
    const rendererCandidates = await listFiles(root, [
      'src/**/*.{ts,tsx,js,jsx}',
    ], IGN)
    const rendererKey = rendererCandidates.filter((p) => /(^|\/)app\.(tsx?|jsx?)$/.test(p) || /(store|zustand)\.(ts|tsx)$/.test(p)).slice(0, maxPerSection)
    if (rendererKey.length) sections.push({ title: 'Key Renderer files', items: rendererKey.map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } })) })

    // Stores & Slices
    const storeFiles = uniq([
      'electron/store/index.ts',
      ...await listFiles(root, ['electron/store/slices/**/*.{ts,tsx}'], IGN)
    ]).slice(0, maxPerSection)
    if (storeFiles.length) sections.push({ title: 'Main Store & Slices', items: storeFiles.map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } })) })

    // IPC
    const ipcFiles = await listFiles(root, ['electron/ipc/**/*.{ts,tsx}'], IGN)
    if (ipcFiles.length) sections.push({ title: 'IPC Handlers', items: ipcFiles.slice(0, maxPerSection).map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } })) })

    // Tools
    const toolFiles = await listFiles(root, ['electron/tools/**/*.{ts,tsx}'], IGN)
    if (toolFiles.length) sections.push({ title: 'Agent Tools', items: toolFiles.slice(0, maxPerSection).map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 } })) })

    // Curated example queries for workspace.search or workspace.jump
    const exampleQueries = [
      'starmap initialization file',
      'zustand store definition',
      'openai provider adapter',
      'terminal pty lifecycle',
      'flow editor nodes',
      'agent tools registry',
      'menu builder',
      'session management'
    ]

    return { ok: true, data: { root: root.replace(/\\/g, '/'), sections, exampleQueries } }
  }
}

export default workspaceMapTool

