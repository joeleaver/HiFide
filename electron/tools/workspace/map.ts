import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import fs from 'node:fs/promises'
import fg from 'fast-glob'
import { grepTool } from '../text/grep'
import { resolveWorkspaceRootAsync } from '../../utils/workspace.js'
import { randomUUID } from 'node:crypto'


async function getWorkspaceRoot(workspaceId?: string): Promise<string> {
  return resolveWorkspaceRootAsync(workspaceId)
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
  name: 'workspaceMap',
  description: 'Compact project map: core directories, key files, and ripgrep landmarks under a small time budget. Use for quick orientation; not a substitute for workspaceSearch.',
  parameters: {
    type: 'object',
    properties: {
      maxPerSection: { type: 'integer', minimum: 1, description: 'Cap per section (default 12)' },
      mode: { type: 'string', enum: ['basic','enriched'], description: 'basic = heuristic only; enriched = adds ripgrep landmarks (default).' },
      timeBudgetMs: { type: 'integer', minimum: 100, description: 'Soft time budget for enriched mode (default ~10s)' }
    },
    additionalProperties: false
  },
  run: async (args: { maxPerSection?: number; mode?: 'basic'|'enriched'; timeBudgetMs?: number } = {}, meta?: any) => {
    const t0 = Date.now()
    const root = await getWorkspaceRoot(meta?.workspaceId)
    const maxPerSection = Math.max(1, args?.maxPerSection ?? 12)
    const mode = args?.mode ?? 'enriched'
    const budgetMs = Math.max(150, args?.timeBudgetMs ?? 10_000)

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

    // Key Electron files - entry points and core infrastructure
    // These represent the main architectural layers of the application
    const electronFiles = uniq([
      'electron/main.ts',                           // Main process entry point
      'electron/core/app.ts',                       // App lifecycle
      'electron/core/window.ts',                    // Window management
      'electron/store/index.ts',                    // Type exports (post-Zustand)
      'electron/tools/index.ts',                    // Agent tools registry
      'electron/ipc/registry.ts',                   // IPC handler registration
      'electron/services/index.ts',                 // Service registry
      'electron/providers-ai-sdk/openai.ts',        // OpenAI provider
      'electron/providers-ai-sdk/anthropic.ts',     // Anthropic provider
      'electron/providers-ai-sdk/gemini.ts',        // Gemini provider
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

    // Enriched additions (default): ripgrep landmarks under a small time budget
    if (mode !== 'basic') {
      const k = Math.min(8, maxPerSection)
      const now = () => Date.now() - t0

      async function grepItems(title: string, pattern: string, files: string[], why: string) {
        if (now() > budgetMs) return
        const res: any = await grepTool.run({ pattern, files, options: { lineNumbers: true, maxResults: 50, ignoreCase: true } })
        const matches = Array.isArray(res?.data?.matches) ? res.data.matches : []
        const items = matches.slice(0, k).map((m: any) => {
          const file = String(m.file || '').replace(/\\/g, '/');
          const ln = Math.max(1, Number(m.lineNumber || 1));
          const start = Math.max(1, ln - 3); const end = Math.max(start, ln + 3)
          return { path: file, handle: toHandle(file, start, end), lines: { start, end }, why }
        })
        if (items.length) sections.push({ title, items })
      }

      await Promise.all([
        grepItems('Landmarks (IPC)', 'ipcMain\\.handle\\(', ['electron/**/*.{ts,tsx}'], 'ipcMain.handle'),
        (async () => {
          if (now() > budgetMs) return
          const res1: any = await grepTool.run({ pattern: 'app\\.whenReady\\(', files: ['electron/**/*.{ts,tsx}'], options: { lineNumbers: true, maxResults: 50, ignoreCase: true } })
          const res2: any = await grepTool.run({ pattern: 'new\\s+BrowserWindow\\(', files: ['electron/**/*.{ts,tsx}'], options: { lineNumbers: true, maxResults: 50, ignoreCase: true } })
          const toItems = (arr: any[], why: string) => (arr||[]).slice(0, k).map((m: any) => {
            const file = String(m.file || '').replace(/\\/g, '/'); const ln = Math.max(1, Number(m.lineNumber || 1)); const start = Math.max(1, ln - 3); const end = Math.max(start, ln + 3)
            return { path: file, handle: toHandle(file, start, end), lines: { start, end }, why }
          })
          const items = [
            ...toItems(res1?.data?.matches || [], 'app.whenReady'),
            ...toItems(res2?.data?.matches || [], 'BrowserWindow')
          ].slice(0, k)
          if (items.length) sections.push({ title: 'Landmarks (App lifecycle)', items })
        })(),
        grepItems('Landmarks (Preload)', 'contextBridge\\.exposeInMainWorld\\(', ['electron/**/*.{ts,tsx}'], 'contextBridge.exposeInMainWorld'),
        (async () => {
          if (now() > budgetMs) return
          const res1: any = await grepTool.run({ pattern: 'create[A-Za-z0-9_]*Slice\\(', files: ['electron/**/*.{ts,tsx}','src/**/*.{ts,tsx}'], options: { lineNumbers: true, maxResults: 50, ignoreCase: true } })
          const res2: any = await grepTool.run({ pattern: 'persist\\(', files: ['electron/**/*.{ts,tsx}'], options: { lineNumbers: true, maxResults: 50, ignoreCase: true } })
          const toItems = (arr: any[], why: string) => (arr||[]).slice(0, k).map((m: any) => {
            const file = String(m.file || '').replace(/\\/g, '/'); const ln = Math.max(1, Number(m.lineNumber || 1)); const start = Math.max(1, ln - 3); const end = Math.max(start, ln + 3)
            return { path: file, handle: toHandle(file, start, end), lines: { start, end }, why }
          })
          const items = [
            ...toItems(res1?.data?.matches || [], 'create*Slice'),
            ...toItems(res2?.data?.matches || [], 'persist()')
          ].slice(0, k)
          if (items.length) sections.push({ title: 'Landmarks (Store / Slices)', items })
        })(),
        (async () => {
          if (now() > budgetMs) return
          const prov = await listFiles(root, ['electron/providers/**/*.{ts,tsx}'], IGN)
          const items = prov.slice(0, k).map((p) => ({ path: p, handle: toHandle(p, 1, 1), lines: { start: 1, end: 1 }, why: 'provider/adapter' }))
          if (items.length) sections.push({ title: 'Providers & LLM adapters', items })



        })()
      ])
    }

    // Optional AST and semantic enrichments (time-budgeted)
    if (mode !== 'basic') {
      // Future: add AST-based enrichments here
    }



    // Curated example queries for workspaceSearch or workspaceJump
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

    const elapsedMs = Date.now() - t0
    return { ok: true, data: { root: root.replace(/\\/g, '/'), sections, exampleQueries, meta: { elapsedMs, mode } } }
  },

  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: true,
          summary: `Workspace map generated (${raw.data.sections?.length || 0} sections)`,
          previewKey
        },
        ui: raw.data,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

export default workspaceMapTool

