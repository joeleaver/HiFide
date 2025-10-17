/**
 * Workspace and project management IPC handlers
 * 
 * Handles workspace root management, folder dialogs, and project bootstrapping
 */

import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { getIndexer, resetIndexer, windowStateStore, providers, getProviderKey } from '../core/state'
import type { ProviderAdapter } from '../types'
import { buildMenu } from './menu'

const exec = promisify(execCb)

/**
 * Check if a path exists
 */
async function pathExists(p: string): Promise<boolean> {
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
async function ensureDir(p: string): Promise<void> {
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
      const model = sel.id === 'anthropic' ? 'claude-3-5-sonnet' : sel.id === 'gemini' ? 'gemini-1.5-pro' : 'gpt-5'
      
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
        await provider.chatStream({
          apiKey: sel.key,
          model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: user },
          ],
          onChunk: (t) => { out += t },
          onDone: () => {},
          onError: (_e) => {},
        })
        
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
 * Get workspace settings file path
 */
function getSettingsPath(): string {
  const { useMainStore } = require('../store/index.js')
  const baseDir = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
  const privateDir = path.join(baseDir, '.hifide-private')
  return path.join(privateDir, 'settings.json')
}

/**
 * Load workspace settings
 */
export async function loadWorkspaceSettings(): Promise<Record<string, any>> {
  try {
    const settingsPath = getSettingsPath()
    const content = await fs.readFile(settingsPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Save workspace settings
 */
export async function saveWorkspaceSettings(settings: Record<string, any>): Promise<void> {
  const settingsPath = getSettingsPath()
  const privateDir = path.dirname(settingsPath)
  await ensureDir(privateDir)
  await atomicWrite(settingsPath, JSON.stringify(settings, null, 2))
}

/**
 * Register workspace IPC handlers
 */
export function registerWorkspaceHandlers(ipcMain: IpcMain): void {
  /**
   * Get workspace root
   */
  ipcMain.handle('workspace:get-root', async () => {
    const { useMainStore } = require('../store/index.js')
    return useMainStore.getState().workspaceRoot || process.cwd()
  })

  /**
   * Set workspace root
   * NOTE: This is deprecated - use the store's setWorkspaceRoot action instead
   */
  ipcMain.handle('workspace:set-root', async (_e, newRoot: string) => {
    try {
      const resolved = path.resolve(newRoot)
      // Verify the directory exists
      await fs.access(resolved)

      // Update store (single source of truth)
      const { useMainStore } = require('../store/index.js')
      useMainStore.getState().setWorkspaceRoot(resolved)

      // Reinitialize indexer with new root
      resetIndexer()
      getIndexer()

      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Open folder dialog
   */
  ipcMain.removeHandler('workspace:open-folder-dialog') // Prevent duplicates during hot reload
  ipcMain.handle('workspace:open-folder-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Folder',
        buttonLabel: 'Open'
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, canceled: true }
      }

      return { ok: true, path: result.filePaths[0] }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Sync recent folders from renderer
   */
  ipcMain.on('workspace:recent-folders-changed', (_e, recentFolders: Array<{ path: string; lastOpened: number }>) => {
    try {
      windowStateStore.set('recentFolders', recentFolders)
    } catch (e) {
      console.error('[workspace] Failed to save recent folders:', e)
    }
    buildMenu()
  })

  /**
   * Bootstrap workspace with .hifide-public and .hifide-private
   */
  ipcMain.handle('workspace:bootstrap', async (_e, args: { baseDir?: string; preferAgent?: boolean; overwrite?: boolean }) => {
    try {
      const { useMainStore } = require('../store/index.js')
      const baseDir = path.resolve(String(args?.baseDir || useMainStore.getState().workspaceRoot || process.cwd()))
      const publicDir = path.join(baseDir, '.hifide-public')
      const privateDir = path.join(baseDir, '.hifide-private')
      let createdPublic = false
      let createdPrivate = false
      let ensuredGitIgnore = false
      let generatedContext = false

      if (!(await pathExists(publicDir))) {
        await ensureDir(publicDir)
        createdPublic = true
      }
      
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
  })

  /**
   * Ensure directory exists
   */
  ipcMain.removeHandler('workspace:ensure-directory')
  ipcMain.handle('workspace:ensure-directory', async (_e, dirPath: string) => {
    try {
      await ensureDir(dirPath)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Check if file exists
   */
  ipcMain.removeHandler('workspace:file-exists')
  ipcMain.handle('workspace:file-exists', async (_e, filePath: string) => {
    try {
      const exists = await pathExists(filePath)
      return exists
    } catch (error) {
      return false
    }
  })

  /**
   * Read file content
   */
  ipcMain.removeHandler('workspace:read-file')
  ipcMain.handle('workspace:read-file', async (_e, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { ok: true, content }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Write file content
   */
  ipcMain.removeHandler('workspace:write-file')
  ipcMain.handle('workspace:write-file', async (_e, filePath: string, content: string) => {
    try {
      await atomicWrite(filePath, content)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * List files in directory
   */
  ipcMain.removeHandler('workspace:list-files')
  ipcMain.handle('workspace:list-files', async (_e, dirPath: string) => {
    try {
      const files = await fs.readdir(dirPath)
      return { ok: true, files }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Get workspace settings
   */
  ipcMain.removeHandler('workspace:get-settings')
  ipcMain.handle('workspace:get-settings', async () => {
    try {
      const settings = await loadWorkspaceSettings()
      return { ok: true, settings }
    } catch (error) {
      return { ok: false, error: String(error), settings: {} }
    }
  })

  /**
   * Set workspace setting
   */
  ipcMain.removeHandler('workspace:set-setting')
  ipcMain.handle('workspace:set-setting', async (_e, key: string, value: any) => {
    try {
      const settings = await loadWorkspaceSettings()
      settings[key] = value
      await saveWorkspaceSettings(settings)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
}

