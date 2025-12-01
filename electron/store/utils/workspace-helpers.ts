/**
 * Workspace helper functions
 *
 * Shared utilities for workspace operations that can be called directly
 * from the store without going through IPC.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { providers, getProviderKey } from '../../core/state'
import type { ProviderAdapter } from '../../providers/provider'
import { resolveWorkspaceRootAsync } from '../../utils/workspace.js'

const exec = promisify(execCb)

/**
 * Check if a path exists
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure directory exists
 */
export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}

/**
 * Check if directory is a git repository
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git rev-parse --is-inside-work-tree', { cwd: dir })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Ensure .gitignore includes .hifide-private
 */
async function ensureGitIgnoreHasPrivate(baseDir: string): Promise<boolean> {
  const giPath = path.join(baseDir, '.gitignore')
  let text = ''
  try {
    text = await fs.readFile(giPath, 'utf-8')
  } catch {
    text = ''
  }

  if (text.includes('.hifide-private')) {
    return false // Already present
  }

  const add = `${text && !text.endsWith('\n') ? '\n' : ''}# Hifide\n.hifide-private\n`
  await fs.writeFile(giPath, text + add, 'utf-8')
  return true
}

/**
 * Atomic file write
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Generate context pack for the project
 */
async function generateContextPack(baseDir: string, preferAgent?: boolean, overwrite?: boolean): Promise<boolean> {
  const publicDir = path.join(baseDir, '.hifide-public')
  await ensureDir(publicDir)
  const ctxJson = path.join(publicDir, 'context.json')
  const ctxMd = path.join(publicDir, 'context.md')

  if (!overwrite && await pathExists(ctxJson)) {
    return false // Already exists
  }

  // Deterministic scan
  const pkgPath = path.join(baseDir, 'package.json')
  let pkg: any = {}
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
  } catch {}

  const has = async (rel: string) => await pathExists(path.join(baseDir, rel))
  const docs: Record<string, string> = {}
  const docFiles = [
    ['readme', 'README.md'],
    ['architecture', 'docs/architecture.md'],
    ['implementationPlan', 'docs/implementation-plan.md'],
    ['retrieval', 'docs/retrieval.md'],
    ['tools', 'docs/tools.md'],
    ['terminal', 'docs/terminal.md'],
    ['verification', 'docs/verification.md'],
    ['roadmap', 'docs/roadmap.md'],
  ] as const

  for (const [key, rel] of docFiles) {
    if (await has(rel)) docs[key] = rel
  }

  const frameworks: string[] = []
  if (await has('electron/main.ts')) frameworks.push('electron')
  if (await has('vite.config.ts')) frameworks.push('vite')
  if (await has('tsconfig.json')) frameworks.push('typescript')
  if (await has('src/App.tsx') || await has('src/main.tsx')) frameworks.push('react')

  const entryPoints: Record<string, string> = {}
  const entries = [
    ['electronMain', 'electron/main.ts'],
    ['preload', 'electron/preload.ts'],
    ['webMain', 'src/main.tsx'],
    ['app', 'src/App.tsx'],
  ] as const

  for (const [k, rel] of entries) {
    if (await has(rel)) entryPoints[k] = rel
  }

  const context: any = {
    project: { name: pkg?.name, version: pkg?.version, description: pkg?.description },
    frameworks,
    entryPoints,
    docs,
    goals: pkg?.description ? [pkg.description] : [],
  }

  // Optional agent enrichment for goals/summary
  if (preferAgent) {
    const pickProvider = async () => {
      const order = ['openai', 'anthropic', 'gemini']
      for (const id of order) {
        const key = await getProviderKey(id)
        if (key) return { id, key }
      }
      return null
    }

    const sel = await pickProvider()
    if (sel) {
      const provider = providers[sel.id] as ProviderAdapter
      const model = sel.id === 'anthropic' ? 'claude-3-5-sonnet' : sel.id === 'gemini' ? 'gemini-1.5-pro' : 'gpt-4o'

      // Read a few high-signal files to feed the model safely (bounded size)
      const readText = async (rel: string) => {
        try {
          return (await fs.readFile(path.join(baseDir, rel), 'utf-8')).slice(0, 6000)
        } catch {
          return ''
        }
      }

      const readme = docs.readme ? await readText(docs.readme) : ''
      const impl = docs.implementationPlan ? await readText(docs.implementationPlan) : ''
      const arch = docs.architecture ? await readText(docs.architecture) : ''

      const prompt = `You will extract project goals and a one-paragraph summary.
Return ONLY JSON: {"goals": string[], "summary": string}.
Be concise and specific to this repository.`
      const user = `README.md:\n${readme}\n\nimplementation-plan.md:\n${impl}\n\narchitecture.md:\n${arch}`.slice(0, 14000)

      let out = ''
      try {
        if (sel.id === 'gemini') {
          await provider.agentStream({
            apiKey: sel.key,
            model,
            systemInstruction: prompt,
            contents: [{ role: 'user', parts: [{ text: user }] }],
            tools: [],
            toolMeta: {},
            onChunk: (t) => { out += t },
            onDone: () => {},
            onError: (_e) => {},
          })
        } else if (sel.id === 'anthropic') {
          await provider.agentStream({
            apiKey: sel.key,
            model,
            system: [{ type: 'text', text: prompt }],
            messages: [{ role: 'user', content: user }],
            tools: [],
            toolMeta: {},
            onChunk: (t) => { out += t },
            onDone: () => {},
            onError: (_e) => {},
          })
        } else {
          // OpenAI / Fireworks (and similar) use top-level system and no system-role messages
          await provider.agentStream({
            apiKey: sel.key,
            model,
            system: prompt,
            messages: [{ role: 'user', content: user }],
            tools: [],
            toolMeta: {},
            onChunk: (t) => { out += t },
            onDone: () => {},
            onError: (_e) => {},
          })
        }

        // Try to parse JSON from out (strip code fences if present)
        const match = out.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            const extra = JSON.parse(match[0])
            if (Array.isArray(extra.goals)) {
              context.goals = Array.from(new Set([...(context.goals || []), ...extra.goals]))
            }
            if (typeof extra.summary === 'string') {
              context.summary = extra.summary
            }
          } catch {}
        }
      } catch {}
    }
  }

  await atomicWrite(ctxJson, JSON.stringify(context, null, 2))
  const md = `# Project Context\n\n- Name: ${context.project?.name || ''}\n- Version: ${context.project?.version || ''}\n- Description: ${context.project?.description || ''}\n- Frameworks: ${frameworks.join(', ')}\n\nKey Docs: ${Object.values(docs).join(', ')}\n\n${context.summary ? '## Summary\n\n' + context.summary : ''}`
  await atomicWrite(ctxMd, md)
  return true
}

/**
 * Bootstrap workspace with .hifide-public and .hifide-private
 */
export async function bootstrapWorkspace(args: { baseDir?: string; preferAgent?: boolean; overwrite?: boolean }) {
  try {
    const baseDir = path.resolve(String(args?.baseDir || await resolveWorkspaceRootAsync()))
    const publicDir = path.join(baseDir, '.hifide-public')
    const kbDir = path.join(publicDir, 'kb')
    const privateDir = path.join(baseDir, '.hifide-private')
    let createdPublic = false
    let createdPrivate = false
    let ensuredGitIgnore = false
    let generatedContext = false

    if (!(await pathExists(publicDir))) {
      await ensureDir(publicDir)
      createdPublic = true
    }

    // Ensure Knowledge Base directory exists per spec
    try { await ensureDir(kbDir) } catch {}

    if (!(await pathExists(privateDir))) {
      await ensureDir(privateDir)
      createdPrivate = true
    }

    if (await isGitRepo(baseDir)) {
      try {
        ensuredGitIgnore = await ensureGitIgnoreHasPrivate(baseDir)
      } catch {}
    }

    try {
      generatedContext = await generateContextPack(baseDir, !!args?.preferAgent, !!args?.overwrite)
    } catch {}

    return { ok: true, createdPublic, createdPrivate, ensuredGitIgnore, generatedContext }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Recursively list workspace files (relative paths)
 * - Skips common heavy/ignored dirs
 * - Optionally filters by extension
 */
export async function listWorkspaceFiles(
  baseDir: string,
  opts?: { includeExts?: string[]; ignoreDirs?: string[]; max?: number }
): Promise<string[]> {
  const includeExts = opts?.includeExts || [
    'ts','tsx','js','jsx','json','md','mdx','yml','yaml','toml','xml','html','css','scss','less',
    'py','rb','php','rs','go','java','kt','c','h','cpp','cc','hpp','cs','sh','ps1','sql','vue','svelte'
  ]
  const ignoreDirs = new Set((opts?.ignoreDirs || [
    'node_modules','.git','.hifide-private','.hifide-public','dist','build','.cache','.next','out'
  ]).map((d) => path.sep + d + path.sep))
  const max = opts?.max ?? 5000

  const out: string[] = []

  async function walk(dir: string, rel: string) {
    if (out.length >= max) return
    let entries: any[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as any
    } catch {
      return
    }
    for (const ent of entries) {
      const nextAbs = path.join(dir, ent.name)
      const nextRel = path.join(rel, ent.name)
      if (ent.isDirectory()) {
        const normalized = path.sep + nextRel + path.sep
        let skip = false
        for (const ig of ignoreDirs) { if (normalized.includes(ig)) { skip = true; break } }
        if (skip) continue
        await walk(nextAbs, nextRel)
        if (out.length >= max) return
      } else if (ent.isFile()) {
        const ext = (ent.name.split('.').pop() || '').toLowerCase()
        if (!includeExts.includes(ext)) continue
        out.push(nextRel)
        if (out.length >= max) return
      }
    }
  }

  await walk(baseDir, '')
  // Remove leading path separators
  return out.map((p) => p.replace(/^\\|^\//, ''))
}


