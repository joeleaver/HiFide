import { app, BrowserWindow, ipcMain, Menu, shell, screen, dialog } from 'electron'

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import Store from 'electron-store'
import * as fsSync from 'node:fs'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'
import type { ProviderAdapter, AgentTool } from './providers/provider'
import { createRequire } from 'node:module'
// Load CJS pty at runtime to avoid bundling and __dirname issues
const require = createRequire(import.meta.url)
// lazy-require pty module inside create handler to allow fallback when Electron prebuild is missing
import { randomUUID } from 'node:crypto'

import { renameSymbol as tsRenameSymbol, organizeImports as tsOrganizeImports, verifyTypecheck as tsVerify, addNamedExport as tsAddNamedExport, moveFileWithImports as tsMoveFile, ensureDefaultExport as tsEnsureDefault, addNamedExportFrom as tsAddExportFrom, extractFunction as tsExtractFunction, suggestParams as tsSuggestParams, inlineVariable as tsInlineVar, inlineFunction as tsInlineFn, convertDefaultToNamed as tsDefaultToNamed, convertNamedToDefault as tsNamedToDefault } from './refactors/ts'


import { astGrepSearch, astGrepRewrite } from './tools/astGrep'
import { Indexer } from './indexing/indexer'
import type { TaskAssessment, TaskType } from './agent/types'
import { calculateBudget, getResourceRecommendation } from './agent/types'

import { buildSystemPrompt, buildPlanningPrompt } from './app/ipc/prompt'
import { getOrCreateSession, initAgentSessionsCleanup } from './session/agentSessions'
import { buildContextMessages } from './app/context/contextBuilder'


import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execCb)

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(DIRNAME, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST




let win: BrowserWindow | null

// PTY policy, redaction and logging helpers
const logsRoot = () => path.join(app.getPath('userData'), 'logs', 'pty')

function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  // Conservative default patterns
  const patterns: RegExp[] = [
    /(?:sk|rk|pk|ak)-[A-Za-z0-9]{16,}/g, // generic key-like
    /Bearer\s+[A-Za-z0-9\-_.=]+/gi,
    /AWS_ACCESS_KEY_ID=[A-Z0-9]{16,}/g,
    /AWS_SECRET_ACCESS_KEY=[A-Za-z0-9\/+=]{32,}/g,
    /(?:(?:xox[pbar]|slack)-)[A-Za-z0-9-]{10,}/g,
    /AIza[0-9A-Za-z\-_]{35}/g,
    /"?password"?\s*[:=]\s*"?[^\s"']{6,}"?/gi,
    /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH) PRIVATE KEY-----/g,
  ]
  let redacted = input
  let beforeLen = input.length
  for (const re of patterns) redacted = redacted.replace(re, '[REDACTED]')
  return { redacted, bytesRedacted: Math.max(0, beforeLen - redacted.length) }
}

function isRiskyCommand(cmd: string): { risky: boolean; reason?: string } {
  const c = cmd.trim()
  const checks: Array<{ re: RegExp; reason: string }> = [

    { re: /\b(pnpm|npm|yarn)\s+install\b/i, reason: 'package install' },
    { re: /\b(pip|pip3)\s+install\b/i, reason: 'pip install' },
    { re: /\brm\s+-rf\b/i, reason: 'remove recursively' },
    { re: /\brimraf\b/i, reason: 'rimraf' },
    { re: /\bdel\b.*\/(s|q)/i, reason: 'windows delete recursive' },
    { re: /\b(prisma)\s+migrate\b/i, reason: 'database migration' },
    { re: /\balembic\s+(upgrade|downgrade)\b/i, reason: 'alembic migration' },
    { re: /\bgit\s+push\s+--force\b/i, reason: 'force push' },
    { re: /\bdocker\s+compose\s+down\b.*-v/i, reason: 'docker remove volumes' },
    { re: /\bkubectl\s+delete\b/i, reason: 'k8s delete' },
  ]
  for (const ch of checks) if (ch.re.test(c)) return { risky: true, reason: ch.reason }
  return { risky: false }
}

async function ensureLogsDir() {
  await fs.mkdir(logsRoot(), { recursive: true })
}

// Indexer singleton
let indexer: Indexer | null = null
function getIndexer(): Indexer {
  if (!indexer) indexer = new Indexer(process.env.APP_ROOT || process.cwd())
  return indexer
}

// Agent session state management moved to session/agentSessions
initAgentSessionsCleanup()

async function logEvent(sessionId: string, type: string, payload: any) {
  try {
    await ensureLogsDir()
    const entry = { ts: new Date().toISOString(), sessionId, type, ...payload }
    await fs.appendFile(path.join(logsRoot(), `${sessionId}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8')
  } catch {}
}
// Secure persistent store for API keys (electron-store handles multi-instance safely)
const secureStore = new Store({
  name: 'hifide-secrets',
  encryptionKey: 'hifide-local-encryption-key', // Basic obfuscation
})

// Window state store for persisting window size and position
const windowStateStore = new Store({
  name: 'hifide-window-state',
})

// In-memory cache for provider API keys (loaded from electron-store on startup)
const providerKeysMem: Record<string, string> = {}

function providerKeyName(provider: string) {
  return provider === 'anthropic' ? 'anthropic' : provider === 'gemini' ? 'gemini' : 'openai'
}

// Load keys from electron-store into memory cache on startup
function loadKeysFromStore() {
  try {
    const openai = secureStore.get('openai') as string | undefined
    const anthropic = secureStore.get('anthropic') as string | undefined
    const gemini = secureStore.get('gemini') as string | undefined
    if (openai) providerKeysMem.openai = openai
    if (anthropic) providerKeysMem.anthropic = anthropic
    if (gemini) providerKeysMem.gemini = gemini
    console.log('[main] Loaded keys from electron-store:', {
      openai: openai ? openai.slice(0, 10) + '...' : 'none',
      anthropic: anthropic ? anthropic.slice(0, 10) + '...' : 'none',
      gemini: gemini ? gemini.slice(0, 10) + '...' : 'none',
    })
  } catch (e) {
    console.error('[main] Failed to load keys from electron-store:', e)
  }
}

// Load keys immediately
loadKeysFromStore()

// Helpers to compute and broadcast presence across windows
function computePresence() {
  const env = process.env
  const hasOpenAI = !!providerKeysMem.openai || !!env?.OPENAI_API_KEY
  const hasAnthropic = !!providerKeysMem.anthropic || !!env?.ANTHROPIC_API_KEY
  const hasGemini = !!providerKeysMem.gemini || !!env?.GEMINI_API_KEY || !!env?.GOOGLE_API_KEY
  return { openai: hasOpenAI, anthropic: hasAnthropic, gemini: hasGemini }
}
function broadcastPresence() {
  const payload = computePresence()
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('secrets:presence-changed', payload) } catch {}
    }
  } catch {}
}

// Secure secret storage IPC handlers (now using electron-store for persistence)
ipcMain.handle('secrets:set', async (_e, k: string) => {
  providerKeysMem['openai'] = k
  secureStore.set('openai', k)
  broadcastPresence()
  return true
})

// Provider-specific secret APIs (now using electron-store for persistence)
ipcMain.handle('secrets:setFor', async (_e, args: { provider: string; key: string }) => {
  const keyName = providerKeyName(args.provider)
  providerKeysMem[keyName] = args.key
  secureStore.set(keyName, args.key)
  console.log(`[main] Saved ${keyName} to electron-store`)
  broadcastPresence()
  return true
})

ipcMain.handle('secrets:getFor', async (_e, provider: string) => {
  const keyName = providerKeyName(provider)
  // Try memory cache first, then electron-store
  if (providerKeysMem[keyName]) return providerKeysMem[keyName]
  const stored = secureStore.get(keyName) as string | undefined
  if (stored) {
    providerKeysMem[keyName] = stored
    return stored
  }
  return null
})




// Helper: get provider API key with env fallback for dev
async function getProviderKey(providerId: string): Promise<string | null> {
  const mem = providerKeysMem[providerKeyName(providerId)]
  console.log(`[main] getProviderKey(${providerId}): mem=${mem ? `${mem.slice(0, 10)}...` : 'none'}`)
  if (mem && mem.trim()) return mem
  const env = process.env
  if (providerId === 'openai' && env?.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (providerId === 'anthropic' && env?.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY
  if (providerId === 'gemini' && (env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY)) return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null
  console.log(`[main] getProviderKey(${providerId}): returning null (no key found)`)
  return null
}

// Provider API key validation
ipcMain.handle('secrets:validateFor', async (_e, args: { provider: string; key: string; model?: string }) => {
  const { provider, key, model } = args
  try {
    if (!key || key.trim().length < 10) return { ok: false, error: 'Key missing or too short' }
    if (provider === 'openai') {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: key })
      // Light, read-only call
      await client.models.list()
      return { ok: true }
    } else if (provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const c = new Anthropic({ apiKey: key })
      const m = model || 'claude-3-5-sonnet'
      // Very cheap token count
      await c.messages.countTokens({ model: m as any, messages: [{ role: 'user', content: 'ping' }] as any })
      return { ok: true }
    } else if (provider === 'gemini') {
      // Validate with public listModels on v1; success implies key is valid regardless of specific model support
      try {
        const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`
        const f: any = (globalThis as any).fetch
        if (!f) return { ok: false, error: 'Fetch API unavailable in main process to validate Gemini key' }
        const resp = await f(url, { method: 'GET' })
        if (resp.ok) {
          // Some SDKs return { models: [...] }, others may wrap in { data: [...] }
          const data = await resp.json().catch(() => ({}))
          if (data && (Array.isArray((data as any).models) || Array.isArray((data as any).data))) {
            return { ok: true }
          }
          // If response body is empty but 200 OK, treat as valid
          return { ok: true }
        } else {
          const txt = await resp.text().catch(() => '')
          return { ok: false, error: `Gemini listModels HTTP ${resp.status}: ${txt.slice(0, 300)}` }
        }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
    return { ok: false, error: 'Unknown provider' }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})


// Presence check: in-memory cache OR env vars indicate a provider is available
ipcMain.handle('secrets:presence', async () => {
  const env = process.env
  const hasOpenAI = !!providerKeysMem.openai || !!env?.OPENAI_API_KEY
  const hasAnthropic = !!providerKeysMem.anthropic || !!env?.ANTHROPIC_API_KEY
  const hasGemini = !!providerKeysMem.gemini || !!env?.GEMINI_API_KEY || !!env?.GOOGLE_API_KEY
  return { openai: hasOpenAI, anthropic: hasAnthropic, gemini: hasGemini }
})

// List available models for a provider using the provider's API
ipcMain.handle('models:list', async (_e, provider: string) => {
  try {
    const prov = provider || 'openai'
    const key = await getProviderKey(prov)
    if (!key) return { ok: false, error: 'Missing API key for provider' }

    if (prov === 'openai') {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: key })
      const res: any = await client.models.list()
      const ids: string[] = (res?.data || [])
        .map((m: any) => m?.id)
        .filter((id: any) => typeof id === 'string')
      // Filter to models relevant for agentic coding (general-purpose chat/coding LLMs)
      const allowPriority = [
        'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4', 'o4-mini', 'o3-mini',
      ]
      const allowed = ids.filter((id) =>
        /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/i.test(id) &&
        !/realtime/i.test(id) &&
        !/(whisper|audio|tts|speech|embedding|embeddings)/i.test(id)
      )
      const uniq = Array.from(new Set(allowed))
      const withLabels = uniq.map((id) => ({ id, label: id }))
      // Sort by our preferred order, then lexicographically
      withLabels.sort((a, b) => {
        const ia = allowPriority.findIndex((p) => a.id.startsWith(p))
        const ib = allowPriority.findIndex((p) => b.id.startsWith(p))
        if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
        return a.id.localeCompare(b.id)
      })
      return { ok: true, models: withLabels }
    }

    if (prov === 'anthropic') {
      const f: any = (globalThis as any).fetch
      if (!f) return { ok: false, error: 'Fetch API unavailable in main process' }
      const resp = await f('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        return { ok: false, error: `Anthropic models HTTP ${resp.status}: ${txt.slice(0, 300)}` }
      }
      const data = await resp.json().catch(() => ({}))
      const arr = Array.isArray((data as any).data)
        ? (data as any).data
        : Array.isArray((data as any).models)
          ? (data as any).models
          : []
      const ids: string[] = arr.map((m: any) => m?.id || m?.name).filter(Boolean)
      // Filter to Claude 3/3.5/3.7 families suitable for agentic coding
      const allowed = ids.filter((id) => /^(claude-3(\.7)?|claude-3-5)/i.test(id))
      const uniq = Array.from(new Set(allowed))
      const withLabels = uniq.map((id) => ({ id, label: id }))
      return { ok: true, models: withLabels }
    }

    if (prov === 'gemini') {
      const f: any = (globalThis as any).fetch
      if (!f) return { ok: false, error: 'Fetch API unavailable in main process' }
      const resp = await f(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`, { method: 'GET' })
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        return { ok: false, error: `Gemini models HTTP ${resp.status}: ${txt.slice(0, 300)}` }
      }
      const data = await resp.json().catch(() => ({}))
      const arr = Array.isArray((data as any).models)
        ? (data as any).models
        : Array.isArray((data as any).data)
          ? (data as any).data
          : []
      const models = arr.map((m: any) => {
        const full = (m?.name || m?.model || '').toString()
        const id = full.startsWith('models/') ? full.split('/').pop() : full
        const supported: string[] = (m?.supportedGenerationMethods || m?.supported_generation_methods || [])
        return { id, label: id, supported }
      }).filter((m: any) => {
        // Only include models that support generateContent and exclude embedding/vision-only models
        const id = m.id || ''
        const hasGenerate = m.supported?.includes('generateContent')
        const isNotEmbedding = !/(embedding|vision)/i.test(id)
        // Exclude image generation preview models
        const isNotImageGen = !/image-generation/i.test(id)
        return hasGenerate && isNotEmbedding && isNotImageGen
      })
      return { ok: true, models }
    }

    return { ok: false, error: 'Unknown provider' }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})



ipcMain.handle('secrets:get', async () => {
  const v = providerKeysMem.openai
  return typeof v === 'string' ? v : null
})

// File system operations
ipcMain.handle('fs:getCwd', async () => {
  return process.cwd()
})

ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return {
      success: true,
      entries: entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name)
      }))
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
  })


// Directory watch management (cross-platform)
let nextWatchId = 1
const activeWatches = new Map<number, { close: () => void }>()

function sendFsEvent(payload: { id: number; type: 'rename'|'change'; path: string; dir: string }) {
  try { win?.webContents.send('fs:watch:event', payload) } catch {}
}

async function addWatchersRecursively(root: string, onEvent: (dir: string, type: 'rename'|'change', filename?: string) => void) {
  const watchers: fsSync.FSWatcher[] = []
  const isLinux = process.platform === 'linux'
  const mkWatcher = (dirPath: string) => {
    const watcher = fsSync.watch(
      dirPath,
      // recursive is only reliably supported on darwin/win32
      isLinux ? undefined : { recursive: true },
      (eventType, filename) => onEvent(dirPath, eventType, typeof filename === 'string' ? filename : undefined)
    )
    watchers.push(watcher)
  }

  let dirCount = 0
  const walk = async (dirPath: string) => {
    mkWatcher(dirPath)
    dirCount++

    // Yield to event loop every 50 directories to prevent blocking
    if (dirCount % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }

    if (!isLinux) return // recursive handles subdirs
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          const child = path.join(dirPath, e.name)
          await walk(child)
        }
      }
    } catch {}
  }

  const t0 = performance.now()
  await walk(root)
  console.log(`[Main] addWatchersRecursively: ${dirCount} directories, ${(performance.now() - t0).toFixed(2)}ms`)

  return () => {
    for (const w of watchers) { try { w.close() } catch {} }
  }
}

ipcMain.handle('fs:watchStart', async (_e, dirPath: string) => {
  try {
    const id = nextWatchId++
    const close = await addWatchersRecursively(dirPath, (dir, type, filename) => {
      const full = filename ? path.join(dir, filename) : dir
      sendFsEvent({ id, type: (type as any) || 'change', path: full, dir })
    })
    activeWatches.set(id, { close })
    return { success: true, id }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('fs:watchStop', async (_e, id: number) => {
  const rec = activeWatches.get(id)
  if (!rec) return { success: false }
  try { rec.close(); activeWatches.delete(id); return { success: true } } catch (error) { return { success: false, error: String(error) } }
})

// Generic file edits (MVP): replaceOnce | insertAfterLine | replaceRange
// Paths are resolved relative to APP_ROOT; writes are atomic and guarded to stay within workspace.
interface ReplaceOnceEdit { type: 'replaceOnce'; path: string; oldText: string; newText: string }
interface InsertAfterLineEdit { type: 'insertAfterLine'; path: string; line: number; text: string }
interface ReplaceRangeEdit { type: 'replaceRange'; path: string; start: number; end: number; text: string }
type FileEdit = ReplaceOnceEdit | InsertAfterLineEdit | ReplaceRangeEdit

function resolveWithinWorkspace(p: string): string {
  const root = path.resolve(process.env.APP_ROOT || process.cwd())
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) throw new Error('Path outside workspace')
  return norm
}

async function atomicWrite(filePath: string, content: string) {
  await fs.writeFile(filePath, content, 'utf-8')
}

// Session management - now workspace-relative
async function getSessionsDir(): Promise<string> {
  const baseDir = path.resolve(process.env.APP_ROOT || process.cwd())
  const privateDir = path.join(baseDir, '.hifide-private')
  const sessionsDir = path.join(privateDir, 'sessions')

  // Ensure directories exist
  try {
    await fs.mkdir(privateDir, { recursive: true })
    await fs.mkdir(sessionsDir, { recursive: true })
  } catch (e) {
    // Ignore if already exists
  }

  return sessionsDir
}

ipcMain.handle('sessions:list', async () => {
  try {
    const sessionsDir = await getSessionsDir()
    const files = await fs.readdir(sessionsDir)
    const sessionFiles = files.filter(f => f.endsWith('.json'))

    const sessions = await Promise.all(
      sessionFiles.map(async (file) => {
        try {
          const filePath = path.join(sessionsDir, file)
          const content = await fs.readFile(filePath, 'utf-8')
          return JSON.parse(content)
        } catch (e) {
          return null
        }
      })
    )

    // Filter out nulls and sort by updatedAt descending
    const validSessions = sessions.filter(s => s !== null).sort((a, b) => b.updatedAt - a.updatedAt)

    return { ok: true, sessions: validSessions }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

ipcMain.handle('sessions:load', async (_e, sessionId: string) => {
  try {
    const sessionsDir = await getSessionsDir()
    const filePath = path.join(sessionsDir, `${sessionId}.json`)
    const content = await fs.readFile(filePath, 'utf-8')
    const session = JSON.parse(content)
    return { ok: true, session }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

ipcMain.handle('sessions:save', async (_e, session: any) => {
  try {
    const sessionsDir = await getSessionsDir()
    const filePath = path.join(sessionsDir, `${session.id}.json`)
    await atomicWrite(filePath, JSON.stringify(session, null, 2))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

ipcMain.handle('sessions:delete', async (_e, sessionId: string) => {
  try {
    const sessionsDir = await getSessionsDir()
    const filePath = path.join(sessionsDir, `${sessionId}.json`)
    await fs.unlink(filePath)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

function insertAfterLine(src: string, line: number, text: string): string {
  if (line <= 0) return text + (src.startsWith('\n') ? '' : '\n') + src
  let idx = 0
  let current = 1
  while (current < line && idx !== -1) {
    idx = src.indexOf('\n', idx)
    if (idx === -1) break
    idx += 1
    current += 1
  }
  if (idx === -1) {
    // append at end
    return src.endsWith('\n') ? (src + text) : (src + '\n' + text)
  }
  const before = src.slice(0, idx)



  const after = src.slice(idx)
  const sep = before.endsWith('\n') ? '' : '\n'
  return before + sep + text + (text.endsWith('\n') ? '' : '\n') + after
}

async function applyFileEditsInternal(edits: FileEdit[] = [], opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}) {
  const results: Array<{ path: string; changed: boolean; message?: string }> = []
  let applied = 0
  for (const ed of edits) {
    try {
      const abs = resolveWithinWorkspace(ed.path)
      let content = ''
      try { content = await fs.readFile(abs, 'utf-8') } catch (e: any) {
        results.push({ path: ed.path, changed: false, message: 'read-failed: ' + (e?.message || String(e)) })
        continue
      }
      let next = content
      if (ed.type === 'replaceOnce') {
        const pos = content.indexOf(ed.oldText)
        if (pos === -1) { results.push({ path: ed.path, changed: false, message: 'oldText-not-found' }); continue }
        next = content.slice(0, pos) + ed.newText + content.slice(pos + ed.oldText.length)
      } else if (ed.type === 'insertAfterLine') {
        next = insertAfterLine(content, ed.line, ed.text)
      } else if (ed.type === 'replaceRange') {
        const s = Math.max(0, Math.min(content.length, ed.start|0))
        const e = Math.max(s, Math.min(content.length, ed.end|0))
        next = content.slice(0, s) + ed.text + content.slice(e)
      } else {
        results.push({ path: (ed as any).path, changed: false, message: 'unknown-edit-type' })
        continue
      }
      if (opts.dryRun) {
        results.push({ path: ed.path, changed: next !== content, message: 'dry-run' })
        if (next !== content) applied += 1
      } else {
        if (next !== content) {
          await atomicWrite(abs, next)
          applied += 1
          results.push({ path: ed.path, changed: true })
        } else {
          results.push({ path: ed.path, changed: false, message: 'no-op' })
        }
      }
    } catch (e: any) {
      results.push({ path: (ed as any)?.path || 'unknown', changed: false, message: e?.message || String(e) })
    }
  }
  const verification = opts.verify ? tsVerify(opts.tsconfigPath) : undefined
  return { ok: true, applied, results, dryRun: !!opts.dryRun, verification }
}

// Agent tool registry (provider-native tool-calling)
// Includes self-regulation tools and file/index operations
const agentTools: AgentTool[] = [
  // Self-regulation tools - allow agent to manage its own resources
  {
    name: 'agent.assess_task',
    description: 'Analyze the user request to determine scope and plan your approach. Call this FIRST before taking other actions to understand your resource budget.',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['simple_query', 'file_edit', 'multi_file_refactor', 'codebase_audit', 'exploration'],
          description: 'What type of task is this? simple_query=read 1 file, file_edit=edit 1-3 files, multi_file_refactor=edit 4+ files, codebase_audit=analyze entire codebase, exploration=understand structure',
        },
        estimated_files: {
          type: 'number',
          description: 'How many files will you likely need to examine?',
        },
        estimated_iterations: {
          type: 'number',
          description: 'How many tool-calling rounds do you estimate?',
        },
        strategy: {
          type: 'string',
          description: 'Brief description of your approach (1-2 sentences)',
        },
      },
      required: ['task_type', 'estimated_files', 'estimated_iterations', 'strategy'],
      additionalProperties: false,
    },
    run: async (input: { task_type: TaskType; estimated_files: number; estimated_iterations: number; strategy: string }, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const budget = calculateBudget(input.task_type, input.estimated_files)

      const assessment: TaskAssessment = {
        task_type: input.task_type,
        estimated_files: input.estimated_files,
        estimated_iterations: input.estimated_iterations,
        strategy: input.strategy,
        token_budget: budget.tokens,
        max_iterations: budget.iterations,
        timestamp: Date.now(),
      }

      session.assessment = assessment

      return {
        ok: true,
        assessment,
        guidance: `Task assessed as "${input.task_type}". You have a budget of ${budget.tokens.toLocaleString()} tokens and ${budget.iterations} iterations. Strategy: ${input.strategy}`,
      }
    },
  },
  {
    name: 'agent.check_resources',
    description: 'Check your current token usage and remaining budget. Use this periodically to stay aware of resource constraints.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: async (_input: any, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const tokenBudget = session.assessment?.token_budget || 50000
      const maxIterations = session.assessment?.max_iterations || 10

      const stats = {
        tokens_used: session.cumulativeTokens,
        tokens_budget: tokenBudget,
        tokens_remaining: tokenBudget - session.cumulativeTokens,
        percentage_used: parseFloat(((session.cumulativeTokens / tokenBudget) * 100).toFixed(1)),
        iterations_used: session.iterationCount,
        iterations_max: maxIterations,
        iterations_remaining: maxIterations - session.iterationCount,
      }

      const recommendation = getResourceRecommendation(stats)

      return {
        ok: true,
        ...stats,
        recommendation,
      }
    },
  },
  {
    name: 'agent.summarize_progress',
    description: 'Summarize what you have learned so far to compress context. Use this when you notice the conversation getting long (>10 tool calls) or before reading many more files.',
    parameters: {
      type: 'object',
      properties: {
        key_findings: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of key findings from your investigation so far',
        },
        files_examined: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files you have already read (so you don\'t re-read them)',
        },
        next_steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'What you still need to investigate',
        },
      },
      required: ['key_findings', 'files_examined', 'next_steps'],
      additionalProperties: false,
    },
    run: async (input: { key_findings: string[]; files_examined: string[]; next_steps: string[] }, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const summary = {
        key_findings: input.key_findings,
        files_examined: input.files_examined,
        next_steps: input.next_steps,
        timestamp: Date.now(),
      }

      session.summaries.push(summary)

      return {
        ok: true,
        summary,
        message: 'Progress summarized. Previous tool outputs will be compressed to save tokens.',
        _meta: { trigger_pruning: true, summary },
      }
    },
  },

  // File system tools
  {
    name: 'fs.read_file',
    description: 'Read a UTF-8 text file from the workspace',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      const content = await fs.readFile(abs, 'utf-8')
      return { ok: true, content }
    },
  },
  {
    name: 'fs.read_dir',
    description: 'List directory entries (name, isDirectory, path)',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      return {
        ok: true,
        entries: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), path: path.join(rel, e.name) })),
      }
    },
  },
  {
    name: 'fs.write_file',
    description: 'Write a UTF-8 text file atomically inside the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run: async ({ path: rel, content }: { path: string; content: string }) => {
      const abs = resolveWithinWorkspace(rel)



      await atomicWrite(abs, content)
      return { ok: true }
    },
  },
  {
    name: 'edits.apply',
    description: 'Apply a list of precise edits (verify with TypeScript when possible)',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
                required: ['type', 'path', 'oldText', 'newText'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'line', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'start', 'end', 'text'],
                additionalProperties: false,
              },
            ],
          },
        },
        verify: { type: 'boolean', default: true },
        tsconfigPath: { type: 'string' },
      },
      required: ['edits'],
      additionalProperties: false,
    },
    run: async ({ edits, verify = true, tsconfigPath }: { edits: any[]; verify?: boolean; tsconfigPath?: string }) => {
      const res = await applyFileEditsInternal(edits, { verify, tsconfigPath })
      return res
    },
  },
  {
    name: 'index.search',
    description: 'Vector search the repository index for relevant code context',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 20 } },
      required: ['query'],
      additionalProperties: false,
    },
    run: async ({ query, k = 8 }: { query: string; k?: number }) => {
      try {
        const res = await getIndexer().search(query.slice(0, 2000), k)
        return { ok: true, ...res }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }


  },
  {
    name: 'terminal.run',
    description: 'Run a shell command non-interactively and return stdout/stderr. Applies risk gating for installs/deletes.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Working directory (workspace-relative or absolute)' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in ms (default 120000)' },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        shell: { type: 'string', description: 'Shell executable to use (optional)' },
        autoApproveEnabled: { type: 'boolean', description: 'Allow auto-approve of risky commands when confidence >= threshold' },
        autoApproveThreshold: { type: 'number', description: 'Confidence threshold for auto-approval' },
        confidence: { type: 'number', description: 'Model confidence in the action (0-1)' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    run: async (
      args: {
        command: string
        cwd?: string
        timeoutMs?: number
        env?: Record<string, string>
        shell?: string
        autoApproveEnabled?: boolean
        autoApproveThreshold?: number
        confidence?: number
      },
      meta?: { requestId?: string }
    ) => {
      const sessionId = meta?.requestId || 'terminal'
      // Resolve cwd safely within workspace when relative
      const cwd = (() => {
        if (!args.cwd) return process.cwd()
        try {
          const root = path.resolve(process.env.APP_ROOT || process.cwd())
          const abs = path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)
          return abs
        } catch {
          return process.cwd()
        }
      })()

      const { risky, reason } = isRiskyCommand(args.command || '')
      await logEvent(sessionId, 'terminal_run_attempt', { command: args.command, cwd, risky, reason })
      if (risky) {
        const autoEnabled = !!args.autoApproveEnabled
        const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1 // impossible by design
        const conf = typeof args.confidence === 'number' ? args.confidence : -1
        const shouldAutoApprove = autoEnabled && conf >= threshold
        if (!shouldAutoApprove) {
          await logEvent(sessionId, 'terminal_run_blocked', { command: args.command, reason, confidence: conf, threshold })
          return { ok: false, blocked: true, reason }
        } else {
          await logEvent(sessionId, 'terminal_run_auto_approved', { command: args.command, reason, confidence: conf, threshold })
        }
      }

      const start = Date.now()
      try {
        const { stdout, stderr } = await exec(args.command, {
          cwd,
          env: { ...process.env, ...(args.env || {}) },
          shell: args.shell,
          timeout: Math.max(1000, Math.min(600000, args.timeoutMs || 120000)),
          maxBuffer: 5 * 1024 * 1024,
        } as any)
        const outR = redactOutput((stdout || '').toString())
        const errR = redactOutput((stderr || '').toString())
        const durationMs = Date.now() - start
        await logEvent(sessionId, 'terminal_run_result', { command: args.command, exitCode: 0, durationMs, bytesRedacted: outR.bytesRedacted + errR.bytesRedacted })
        return { ok: true, exitCode: 0, stdout: outR.redacted, stderr: errR.redacted, durationMs }
      } catch (e: any) {
        const outR = redactOutput((e?.stdout || '').toString())
        const errR = redactOutput((e?.stderr || '').toString())
        const code = typeof e?.code === 'number' ? e.code : (e?.killed ? -1 : 1)
        const timedOut = !!e?.killed || /timed out|ETIMEDOUT/i.test(e?.message || '')
        const durationMs = Date.now() - start
        await logEvent(sessionId, 'terminal_run_result', { command: args.command, exitCode: code, timedOut, durationMs, error: e?.message, bytesRedacted: outR.bytesRedacted + errR.bytesRedacted })
        return { ok: false, exitCode: code, timedOut, error: e?.message || String(e), stdout: outR.redacted, stderr: errR.redacted, durationMs }
      }
    }


  },
  {
    name: 'terminal.session_present',
    description: 'Present a reusable terminal session bound to the agent request. Returns metadata and tiny tails; does not stream large output.',
    parameters: {
      type: 'object',
      properties: {
        ensureCwd: { type: 'string', description: 'Optional desired working directory (workspace-relative or absolute)' },
        shell: { type: 'string' },
        cols: { type: 'integer', minimum: 20, maximum: 400 },
        rows: { type: 'integer', minimum: 10, maximum: 200 }
      },
      additionalProperties: false,
    },
    run: async (
      args: { ensureCwd?: string; shell?: string; cols?: number; rows?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const root = path.resolve(process.env.APP_ROOT || process.cwd())
      const desiredCwd = args.ensureCwd ? (path.isAbsolute(args.ensureCwd) ? args.ensureCwd : path.join(root, args.ensureCwd)) : undefined
      const sid = await (globalThis as any).__getOrCreateAgentPtyFor(req, { shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows })
      const rec = (globalThis as any).__agentPtySessions.get(sid)
      if (!rec) return { ok: false, error: 'no-session' }
      const state = rec.state
      const lastCmds = state.commands.slice(-5).map((c: any) => ({ id: c.id, command: c.command.slice(0, 200), startedAt: c.startedAt, endedAt: c.endedAt, bytes: c.bytes, tail: c.data.slice(-200) }))
      return {
        ok: true,
        sessionId: sid,
        shell: rec.shell,
        cwd: rec.cwd,
        cols: rec.cols,
        rows: rec.rows,
        commandCount: state.commands.length,
        lastCommands: lastCmds,
        liveTail: state.ring.slice(-400)
      }
    }
  },
  {
    name: 'terminal.session_exec',
    description: 'Write a command to the presented terminal (adds a newline). Records output into a new command record. Risk gating applies to destructive installs/deletes.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        autoApproveEnabled: { type: 'boolean' },
        autoApproveThreshold: { type: 'number' },
        confidence: { type: 'number' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    run: async (
      args: { command: string; autoApproveEnabled?: boolean; autoApproveThreshold?: number; confidence?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const sid = await (globalThis as any).__getOrCreateAgentPtyFor(req)
      const rec = (globalThis as any).__agentPtySessions.get(sid)
      if (!rec) return { ok: false, error: 'no-session' }
      const { risky, reason } = isRiskyCommand(args.command)
      await logEvent(sid, 'agent_pty_command_attempt', { command: args.command, risky, reason })
      if (risky) {
        const autoEnabled = !!args.autoApproveEnabled
        const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1
        const conf = typeof args.confidence === 'number' ? args.confidence : -1
        if (!(autoEnabled && conf >= threshold)) {
          await logEvent(sid, 'agent_pty_command_blocked', { command: args.command, reason, confidence: conf, threshold })
          return { ok: false, blocked: true, reason }
        }
      }
      await (globalThis as any).__beginAgentCommand(rec.state, args.command)
      try {
        rec.p.write(args.command + (process.platform === 'win32' ? '\r\n' : '\n'))
        return { ok: true, sessionId: sid }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
  },
  {
    name: 'terminal.session_search_output',
    description: 'Search the session\'s captured command outputs and/or live buffer for a substring; returns compact snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        caseSensitive: { type: 'boolean' },
        in: { type: 'string', enum: ['commands','live','all'], default: 'all' },
        maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 }
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (
      args: { query: string; caseSensitive?: boolean; in?: 'commands'|'live'|'all'; maxResults?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
      if (!sid || !rec) return { ok: false, error: 'no-session' }
      const st = rec.state
      const q = args.caseSensitive ? args.query : args.query.toLowerCase()
      const max = Math.min(200, Math.max(1, args.maxResults || 30))
      const where = args.in || 'all'
      const results: any[] = []
      function findIn(text: string, source: any) {
        const hay = args.caseSensitive ? text : text.toLowerCase()
        let idx = 0
        while (results.length < max) {
          const pos = hay.indexOf(q, idx)
          if (pos === -1) break
          const start = Math.max(0, pos - 80)
          const end = Math.min(text.length, pos + q.length + 80)
          const snippet = text.slice(start, end)
          results.push({ ...source, pos, snippet })
          idx = pos + q.length
        }
      }
      if (where === 'all' || where === 'commands') {
        for (let i = st.commands.length - 1; i >= 0 && results.length < max; i--) {
          const c = st.commands[i]
          findIn(c.data, { type: 'command', id: c.id, command: c.command.slice(0, 200), startedAt: c.startedAt, endedAt: c.endedAt })
        }
      }
      if (where === 'all' || where === 'live') {
        findIn(st.ring, { type: 'live' })
      }
      return { ok: true, sessionId: sid, hits: results }
    }
  },
  {
    name: 'terminal.session_tail',
    description: 'Return the last part of the live buffer (small tail only) to inspect recent output without flooding tokens.',
    parameters: {
      type: 'object',
      properties: { maxBytes: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 } },
      additionalProperties: false,
    },
    run: async (args: { maxBytes?: number }, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
      if (!sid || !rec) return { ok: false, error: 'no-session' }
      const n = Math.max(100, Math.min(10000, args.maxBytes || 2000))
      const tail = rec.state.ring.slice(-n)
      const { redacted } = redactOutput(tail)
      return { ok: true, sessionId: sid, tail: redacted }
    }
  },
  {
    name: 'terminal.session_restart',
    description: 'Restart the presented terminal session (kills and recreates).',
    parameters: { type: 'object', properties: { shell: { type: 'string' }, cwd: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' } }, additionalProperties: false },
    run: async (args: { shell?: string; cwd?: string; cols?: number; rows?: number }, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const old = (globalThis as any).__agentPtyAssignments.get(req)
      if (old) {
        try { (globalThis as any).__agentPtySessions.get(old)?.p.kill() } catch {}
        (globalThis as any).__agentPtySessions.delete(old)
      }
      const root = path.resolve(process.env.APP_ROOT || process.cwd())
      const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined
      const tmpSid = await (globalThis as any).__createAgentPtySession({ shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows }) as string
      ;(globalThis as any).__agentPtyAssignments.set(req, tmpSid)
      return { ok: true, sessionId: tmpSid }
    }
  },
  {
    name: 'terminal.session_close',
    description: 'Close the presented terminal session and clear assignment.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_args: {}, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      if (!sid) return { ok: true }
      try { (globalThis as any).__agentPtySessions.get(sid)?.p.kill() } catch {}
      (globalThis as any).__agentPtySessions.delete(sid)
      (globalThis as any).__agentPtyAssignments.delete(req)
      return { ok: true }
    }
  },
  {
    name: 'code.search_ast',
    description: 'Structural AST search using @ast-grep/napi (inline patterns only)',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'ast-grep inline pattern, e.g., console.log($VAL)' },
        languages: { type: 'array', items: { type: 'string' }, description: "Optional languages. Use 'auto' by file extension if omitted" },
        includeGlobs: { type: 'array', items: { type: 'string' } },
        excludeGlobs: { type: 'array', items: { type: 'string' } },
        maxMatches: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        contextLines: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
        maxFileBytes: { type: 'integer', minimum: 1, default: 1000000 },
        concurrency: { type: 'integer', minimum: 1, maximum: 32, default: 6 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    run: async (args: { pattern: string; languages?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; maxMatches?: number; contextLines?: number; maxFileBytes?: number; concurrency?: number }) => {
      try {
        const res = await astGrepSearch({
          pattern: args.pattern,
          languages: (args.languages && args.languages.length) ? args.languages : 'auto',
          includeGlobs: args.includeGlobs,
          excludeGlobs: args.excludeGlobs,
          maxMatches: args.maxMatches,
          contextLines: args.contextLines,
          maxFileBytes: args.maxFileBytes,
          concurrency: args.concurrency,
        })
        return { ok: true, ...res }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    },
  },
  {
    name: 'code.apply_edits_targeted',
    description: 'Apply targeted edits: simple text edits and/or cross-language AST rewrites via ast-grep. Supports dryRun and ranges-only modes.',
    parameters: {
      type: 'object',
      properties: {
        textEdits: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
                required: ['type', 'path', 'oldText', 'newText'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'line', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'start', 'end', 'text'],
                additionalProperties: false,
              },
            ],
          },
        },
        astRewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              rewrite: { type: 'string' },
              languages: { type: 'array', items: { type: 'string' } },
              includeGlobs: { type: 'array', items: { type: 'string' } },
              excludeGlobs: { type: 'array', items: { type: 'string' } },
              perFileLimit: { type: 'integer', minimum: 1, maximum: 1000 },
              totalLimit: { type: 'integer', minimum: 1, maximum: 100000 },
              maxFileBytes: { type: 'integer', minimum: 1 },
              concurrency: { type: 'integer', minimum: 1, maximum: 32 },
            },
            required: ['pattern', 'rewrite'],
            additionalProperties: false,
          },
        },
        advancedTextEdits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              guard: {
                type: 'object',
                properties: { expectedBefore: { type: 'string' }, checksum: { type: 'string' } },
                additionalProperties: false
              },
              selector: {
                oneOf: [
                  { type: 'object', properties: { range: { type: 'object', properties: { start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['start','end'] } }, required: ['range'] },
                  { type: 'object', properties: { anchors: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } } } }, required: ['anchors'] },
                  { type: 'object', properties: { regex: { type: 'object', properties: { pattern: { type: 'string' }, flags: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } }, required: ['pattern'] } }, required: ['regex'] },
                  { type: 'object', properties: { structuralMatch: { type: 'object', properties: { file: { type: 'string' }, start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['file','start','end'] } }, required: ['structuralMatch'] }
                ]
              },
              action: {
                oneOf: [
                  { type: 'object', properties: { 'text.replace': { type: 'object', properties: { newText: { type: 'string' } }, required: ['newText'] } }, required: ['text.replace'] },
                  { type: 'object', properties: { 'text.insert': { type: 'object', properties: { position: { enum: ['before','after','start','end'] }, text: { type: 'string' } }, required: ['position','text'] } }, required: ['text.insert'] },
                  { type: 'object', properties: { 'text.delete': { type: 'object' } }, required: ['text.delete'] },
                  { type: 'object', properties: { 'text.wrap': { type: 'object', properties: { prefix: { type: 'string' }, suffix: { type: 'string' } }, required: ['prefix','suffix'] } }, required: ['text.wrap'] }
                ]
              }
            },
            required: ['path','selector','action'],
            additionalProperties: false
          }
        },
        dryRun: { type: 'boolean', default: false },
        rangesOnly: { type: 'boolean', default: false },
        verify: { type: 'boolean', default: true },
        tsconfigPath: { type: 'string' }
      },
      additionalProperties: false,
    },
    run: async (args: { textEdits?: any[]; astRewrites?: any[]; advancedTextEdits?: any[]; dryRun?: boolean; rangesOnly?: boolean; verify?: boolean; tsconfigPath?: string }) => {
      const dryRun = !!args.dryRun
      const rangesOnly = !!args.rangesOnly
      const verify = args.verify !== false
      const textEdits = Array.isArray(args.textEdits) ? args.textEdits : []
      const astOps = Array.isArray(args.astRewrites) ? args.astRewrites : []
      const advOps = Array.isArray(args.advancedTextEdits) ? args.advancedTextEdits : []
      try {
        const resText = textEdits.length ? await applyFileEditsInternal(textEdits, { dryRun, verify: false }) : { applied: 0, results: [] as any[] }
        const astResults: any[] = []
        let astApplied = 0
        for (const op of astOps) {
          const r = await astGrepRewrite({
            pattern: op.pattern,
            rewrite: op.rewrite,
            languages: (op.languages && op.languages.length) ? op.languages : 'auto',
            includeGlobs: op.includeGlobs,
            excludeGlobs: op.excludeGlobs,
            perFileLimit: op.perFileLimit,
            totalLimit: op.totalLimit,
            maxFileBytes: op.maxFileBytes,
            concurrency: op.concurrency,
            dryRun,
            rangesOnly,
          })
          astResults.push(r)
          astApplied += r.changes.reduce((acc, c) => acc + (c.applied ? c.count : 0), 0)
        }

        // Advanced text edits
        const advResults: any[] = []
        let advApplied = 0
        const byFile: Record<string, any[]> = {}
        for (const ed of advOps) {
          if (!byFile[ed.path]) byFile[ed.path] = []
          byFile[ed.path].push(ed)
        }
        const crypto = await import('node:crypto')
        for (const [p, ops] of Object.entries(byFile)) {
          const abs = resolveWithinWorkspace(p)
          let content = ''
          try { content = await fs.readFile(abs, 'utf-8') } catch { advResults.push({ path: p, changed: false, message: 'read-failed' }); continue }
          const origChecksum = crypto.createHash('sha1').update(content, 'utf8').digest('hex')
          let changed = false
          const lines = content.split(/\r?\n/)
          const idx: number[] = [0]; for (let i=0;i<lines.length;i++) idx.push(idx[i] + lines[i].length + 1)
          function off(line1: number, col1: number) { const l0 = Math.max(0, Math.min(idx.length-2, (line1|0)-1)); return idx[l0] + Math.max(0, (col1|0)-1) }

          for (const op of ops) {
            // Resolve selection
            let s = 0, e = 0
            if (op.selector?.range) {
              s = off(op.selector.range.start.line, op.selector.range.start.column)
              e = off(op.selector.range.end.line, op.selector.range.end.column)
            } else if (op.selector?.anchors) {
              const before = op.selector.anchors.before || ''
              const after = op.selector.anchors.after || ''
              const occ = Math.max(1, op.selector.anchors.occurrence || 1)
              if (before) {
                let pos = -1, from = 0
                for (let i=0;i<occ;i++) { pos = content.indexOf(before, from); if (pos === -1) break; from = pos + before.length }
                if (pos !== -1) s = pos + before.length
              }
              if (after) {
                const pos = content.indexOf(after, s)
                if (pos !== -1) e = pos
              } else { e = s }
            } else if (op.selector?.regex) {
              const re = new RegExp(op.selector.regex.pattern, op.selector.regex.flags || 'g')
              const occ = Math.max(1, op.selector.regex.occurrence || 1)
              let m: RegExpExecArray | null = null
              let count = 0
              while ((m = re.exec(content))) { count++; if (count === occ) { s = m.index; e = m.index + m[0].length; break } if (!re.global) break }
            } else if (op.selector?.structuralMatch) {
              s = off(op.selector.structuralMatch.start.line, op.selector.structuralMatch.start.column)
              e = off(op.selector.structuralMatch.end.line, op.selector.structuralMatch.end.column)
            } else {
              advResults.push({ path: p, changed: false, message: 'bad-selector' }); continue
            }

            const selected = content.slice(s, e)
            // Guards
            if (op.guard?.expectedBefore && !selected.includes(op.guard.expectedBefore)) { advResults.push({ path: p, changed: false, message: 'guard-mismatch' }); continue }
            if (op.guard?.checksum && op.guard.checksum !== origChecksum) { advResults.push({ path: p, changed: false, message: 'stale-file' }); continue }

            // Action
            let next = content
            if (op.action['text.replace']) {
              next = content.slice(0, s) + op.action['text.replace'].newText + content.slice(e)
            } else if (op.action['text.insert']) {
              const pos = op.action['text.insert'].position
              const ins = op.action['text.insert'].text
              if (pos === 'before') next = content.slice(0, s) + ins + content.slice(s)
              else if (pos === 'after') next = content.slice(0, e) + ins + content.slice(e)
              else if (pos === 'start') next = ins + content
              else next = content + ins
            } else if (op.action['text.delete']) {
              next = content.slice(0, s) + content.slice(e)
            } else if (op.action['text.wrap']) {
              const pre = op.action['text.wrap'].prefix, suf = op.action['text.wrap'].suffix
              next = content.slice(0, s) + pre + selected + suf + content.slice(e)
            } else {
              advResults.push({ path: p, changed: false, message: 'bad-action' }); continue
            }

            const start = (()=>{ // recalc start/end lines
              const lines2 = content.slice(0, s).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 }
            })()
            const end = (()=>{ const lines2 = content.slice(0, e).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 } })()
            advResults.push({ path: p, changed: !dryRun && !rangesOnly && next !== content, ranges: [{ startLine: start.line, startCol: start.column, endLine: end.line, endCol: end.column }] })
            if (!dryRun && !rangesOnly && next !== content) { content = next; changed = true }
          }

          if (!dryRun && !rangesOnly && changed) {
            await atomicWrite(abs, content)
            advApplied += 1
          }
        }

        let verification: any = undefined
        if (verify && !dryRun && !rangesOnly) {
          try { verification = tsVerify(args.tsconfigPath) } catch {}
        }
        return {
          ok: true,
          applied: (resText.applied || 0) + astApplied + advApplied,
          results: [
            ...(resText.results || []),
            ...astResults.flatMap((r) => r.changes.map((c: any) => ({ path: c.filePath, changed: !!c.applied, ranges: c.ranges, count: c.count }))),
            ...advResults
          ],
          dryRun,
          rangesOnly,
          verification,
        }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    },
  }
];

ipcMain.handle('edits:apply', async (_e, args: { edits: FileEdit[]; dryRun?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    return await applyFileEditsInternal(args.edits, { dryRun: args.dryRun, verify: args.verify, tsconfigPath: args.tsconfigPath })
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), applied: 0, results: [], dryRun: !!args.dryRun }
  }


})


// Embedded PTY session management
// Minimal PTY interface to describe what we use
type IPty = {
  onData: (cb: (data: string) => void) => void
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  kill: () => void
  pid: number
  onExit: (cb: (ev: { exitCode: number }) => void) => void
}

const ptySessions = new Map<string, { p: IPty; wcId: number; log?: boolean }>()

ipcMain.handle('pty:create', async (event, opts: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean } = {}) => {
  const wc = event.sender
  const isWin = process.platform === 'win32'


  const shell = opts.shell || (isWin ? (process.env.COMSPEC || 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe') : (process.env.SHELL || '/bin/bash'))
  const cols = opts.cols || 80
  const rows = opts.rows || 24
  const env = { ...process.env, ...(opts.env || {}) }
  const cwd = opts.cwd || process.cwd()
  try {
    const ptyModule = require('@homebridge/node-pty-prebuilt-multiarch')
    const p = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env })
    const sessionId = randomUUID()
    ptySessions.set(sessionId, { p, wcId: wc.id, log: opts.log !== false })
    await logEvent(sessionId, 'session_create', { shell, cwd, cols, rows })
    p.onData(async (data: string) => {
      try {
        const { redacted, bytesRedacted } = redactOutput(data)
        if (bytesRedacted > 0) { await logEvent(sessionId, 'data_redacted', { bytesRedacted }) }
        wc.send('pty:data', { sessionId, data: redacted })
      } catch {}
    })
    p.onExit(async ({ exitCode }: { exitCode: number }) => {
      try { wc.send('pty:exit', { sessionId, exitCode }) } catch {}
      await logEvent(sessionId, 'session_exit', { exitCode })
      ptySessions.delete(sessionId)
    })
    return { sessionId }
  } catch (e: any) {
    throw e
  }
})

// Agent-initiated command execution with policy gating
ipcMain.handle('pty:exec-agent', async (_event, args: { sessionId: string; command: string; confidence?: number; autoApproveEnabled?: boolean; autoApproveThreshold?: number }) => {
  const s = ptySessions.get(args.sessionId)
  if (!s) return { ok: false, error: 'no-session' }
  const { risky, reason } = isRiskyCommand(args.command)
  await logEvent(args.sessionId, 'command_attempt', { command: args.command, risky, reason })
  if (risky) {
    const autoEnabled = !!args.autoApproveEnabled
    const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1 // impossible
    const conf = typeof args.confidence === 'number' ? args.confidence : -1
    const shouldAutoApprove = autoEnabled && conf >= threshold

    if (shouldAutoApprove) {
      await logEvent(args.sessionId, 'command_decision', { command: args.command, allowed: true, decision_reason: 'auto_approved', confidence: conf, threshold })
    } else {
      let allowed = false
      try {
        if (win && !win.isDestroyed()) {
          const { dialog } = await import('electron')
          const r = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Allow', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Confirm risky command',
            message: `This command may be risky (${reason}).`,
            detail: args.command,
            noLink: true,
          })
          allowed = r.response === 0
        }
      } catch {
        allowed = false
      }
      await logEvent(args.sessionId, 'command_decision', { command: args.command, allowed, decision_reason: 'manual', confidence: conf, threshold })
      if (!allowed) return { ok: false, blocked: true }
    }
  }
  // Write command followed by newline
  s.p.write(args.command + (process.platform === 'win32' ? '\r\n' : '\n'))
  return { ok: true }
})

// TypeScript refactor IPCs (MVP)
ipcMain.handle('tsrefactor:rename', async (_e, args: { filePath: string; oldName: string; newName: string; verify?: boolean; tsconfigPath?: string }) => {
  try {
    await tsRenameSymbol(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:organizeImports', async (_e, args: { filePath?: string; verify?: boolean; tsconfigPath?: string }) => {
  try {
    await tsOrganizeImports(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})
ipcMain.handle('tsrefactor:addExportNamed', async (_e, args: { filePath: string; exportName: string; code?: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsAddNamedExport(args)
// Indexing IPC

    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:moveFile', async (_e, args: { fromPath: string; toPath: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsMoveFile(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:ensureDefaultExport', async (_e, args: { filePath: string; name?: string; code?: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsEnsureDefault(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:addExportFrom', async (_e, args: { indexFilePath: string; exportName: string; fromFilePath: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsAddExportFrom(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})
ipcMain.handle('tsrefactor:suggestParams', async (_e, args: { filePath: string; start: number; end: number; tsconfigPath?: string }) => {
  try {
    const result = await tsSuggestParams(args)
    return { ok: true, ...result }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})



ipcMain.handle('tsrefactor:extractFunction', async (_e, args: { filePath: string; start: number; end: number; newName: string; params?: string[]; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsExtractFunction(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})
ipcMain.handle('tsrefactor:inlineVariable', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsInlineVar(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:inlineFunction', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsInlineFn(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:defaultToNamed', async (_e, args: { filePath: string; newName: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsDefaultToNamed(args)

// Agent-managed PTY sessions (no UI streaming): ring buffer + per-command capture
// Keeps memory bounded and enables searchable command outputs for the agent

type AgentTerminalState = {
  ring: string
  ringLimit: number
  commands: Array<{ id: number; command: string; startedAt: number; endedAt?: number; bytes: number; data: string }>
  maxCommands: number
  activeIndex: number | null
}

const agentPtySessions = new Map<string, { p: IPty; shell: string; cwd: string; cols: number; rows: number; state: AgentTerminalState; attachedWcIds: Set<number> }>()
const agentPtyAssignments = new Map<string, string>() // requestId -> sessionId

function trimRing(s: string, limit: number) {
  if (s.length <= limit) return s
  return s.slice(s.length - limit)
}

function pushDataToState(st: AgentTerminalState, chunk: string) {
  const { redacted } = redactOutput(chunk)
  st.ring = trimRing(st.ring + redacted, st.ringLimit)
  if (st.activeIndex != null) {
    const rec = st.commands[st.activeIndex]
    if (rec) {
      rec.data = trimRing(rec.data + redacted, Math.min(st.ringLimit, 500_000))
      rec.bytes += Buffer.byteLength(redacted, 'utf8')
    }
  }
}

async function beginCommand(st: AgentTerminalState, cmd: string) {
  // finalize previous
  if (st.activeIndex != null && st.commands[st.activeIndex]) {
    st.commands[st.activeIndex].endedAt = Date.now()
  }
  // cull old
  if (st.commands.length >= st.maxCommands) st.commands.shift()
  const rec = { id: (st.commands.at(-1)?.id ?? 0) + 1, command: cmd, startedAt: Date.now(), bytes: 0, data: '' }
  st.commands.push(rec)
  st.activeIndex = st.commands.length - 1
}

async function createAgentPtySession(opts: { shell?: string; cwd?: string; cols?: number; rows?: number }) {
  const isWin = process.platform === 'win32'
  const shell = opts.shell || (isWin ? (process.env.COMSPEC || 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe') : (process.env.SHELL || '/bin/bash'))
  const cols = opts.cols || 80
  const rows = opts.rows || 24
  const cwd = opts.cwd || process.cwd()
  const ptyModule = require('@homebridge/node-pty-prebuilt-multiarch')
  const p: IPty = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env: process.env })
  const sessionId = randomUUID()
  const state: AgentTerminalState = { ring: '', ringLimit: 1_000_000, commands: [], maxCommands: 50, activeIndex: null }
  agentPtySessions.set(sessionId, { p, shell, cwd, cols, rows, state, attachedWcIds: new Set<number>() })
  await logEvent(sessionId, 'agent_pty_create', { shell, cwd, cols, rows })
  p.onData(async (data: string) => {
    try {
      const { redacted, bytesRedacted } = redactOutput(data)
      if (bytesRedacted > 0) { await logEvent(sessionId, 'data_redacted', { bytesRedacted }) }
      // Update in-memory buffers (safe to re-redact downstream if needed)
      pushDataToState(state, redacted)
      // Fanout to any attached renderer terminals
      const rec = agentPtySessions.get(sessionId)
      const ids = rec?.attachedWcIds
      if (ids && ids.size > 0) {
        for (const id of ids) {
          try {
            const wc = BrowserWindow.fromId(id)?.webContents
            if (wc) wc.send('pty:data', { sessionId, data: redacted })
          } catch {}
        }
      }
    } catch {}
  })
  p.onExit(async ({ exitCode }: { exitCode: number }) => {
    await logEvent(sessionId, 'agent_pty_exit', { exitCode })
    // Notify any attached renderers
    const rec = agentPtySessions.get(sessionId)
    const ids = rec?.attachedWcIds
    if (ids && ids.size > 0) {
      for (const id of ids) {
        try { BrowserWindow.fromId(id)?.webContents?.send('pty:exit', { sessionId, exitCode }) } catch {}
      }
    }
    agentPtySessions.delete(sessionId)
    // detach assignment if any
    for (const [req, sid] of agentPtyAssignments.entries()) if (sid === sessionId) agentPtyAssignments.delete(req)
  })

  return sessionId
}

async function getOrCreateAgentPtyFor(requestId: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }) {
  let sid = agentPtyAssignments.get(requestId)
  if (sid && agentPtySessions.has(sid)) return sid
  sid = await createAgentPtySession(opts || {})
  agentPtyAssignments.set(requestId, sid)
  return sid
}

// Expose agent PTY helpers for use in earlier-declared tool handlers
;(globalThis as any).__agentPtySessions = agentPtySessions
;(globalThis as any).__agentPtyAssignments = agentPtyAssignments
;(globalThis as any).__createAgentPtySession = createAgentPtySession
;(globalThis as any).__getOrCreateAgentPtyFor = getOrCreateAgentPtyFor
;(globalThis as any).__beginAgentCommand = beginCommand


    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('tsrefactor:namedToDefault', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
  try {
    const result = await tsNamedToDefault(args)
    const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
    return { ok: true, ...result, verification }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})

// Indexing IPC

// Attach a renderer window to an agent-managed PTY session so it streams into the existing xterm UI
ipcMain.handle('agent-pty:attach', async (event, args: { requestId?: string; sessionId?: string; tailBytes?: number } = {}) => {
  const wc = event.sender
  let sid = args.sessionId
  if (!sid) {
    const req = args.requestId || 'terminal'
    sid = await (globalThis as any).__getOrCreateAgentPtyFor(req)
  }
  const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
  if (!sid || !rec) return { ok: false, error: 'no-session' }
  rec.attachedWcIds.add(wc.id)
  // Optionally seed terminal with current tail (already redacted in state)
  const n = Math.max(0, Math.min(10000, args.tailBytes || 0))
  if (n > 0) {
    try { wc.send('pty:data', { sessionId: sid, data: rec.state.ring.slice(-n) }) } catch {}
  }
  return { ok: true, sessionId: sid }
})

ipcMain.handle('agent-pty:detach', async (event, args: { sessionId: string }) => {
  const wc = event.sender
  const rec = (globalThis as any).__agentPtySessions.get(args.sessionId)
  if (!rec) return { ok: true }
  rec.attachedWcIds.delete(wc.id)
  return { ok: true }
})

ipcMain.handle('index:rebuild', async () => {
  try {
    const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
    await getIndexer().rebuild((p) => { try { wc?.send('index:progress', p) } catch {} })
    // Begin watching for incremental changes after a successful rebuild
    try { getIndexer().startWatch((p) => { try { wc?.send('index:progress', p) } catch {} }) } catch {}
    // Opportunistically (re)generate context pack; won't overwrite existing
    try { await generateContextPack(process.env.APP_ROOT || process.cwd(), true) } catch {}
    return { ok: true, status: getIndexer().status() }
  } catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})
ipcMain.handle('index:status', async () => {
  try { return { ok: true, status: getIndexer().status() } }
  catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})
ipcMain.handle('index:cancel', async () => {
  try { getIndexer().cancel(); return { ok: true } }
  catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})
ipcMain.handle('index:clear', async () => {
  try { getIndexer().clear(); return { ok: true } }
  catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})
ipcMain.handle('index:search', async (_e, args: { query: string; k?: number }) => {
  try { const res = await getIndexer().search(args.query, args.k ?? 8); return { ok: true, ...res } }
  catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})






ipcMain.handle('pty:write', async (_event, args: { sessionId: string; data: string }) => {
  const s = ptySessions.get(args.sessionId)



  if (!s) {
    console.warn('[pty:write] no session', args.sessionId, 'len', args.data?.length)
    return { ok: false }
  }
  try {
    s.p.write(args.data)
    return { ok: true }
  } catch (e) {
    console.error('[pty:write] error', e)
    return { ok: false, error: (e as any)?.message || String(e) }
  }
})

ipcMain.handle('pty:resize', async (_event, args: { sessionId: string; cols: number; rows: number }) => {
  const s = ptySessions.get(args.sessionId)
  if (s) s.p.resize(args.cols, args.rows)
  return { ok: !!s }
})

ipcMain.handle('pty:dispose', async (_event, args: { sessionId: string }) => {
  const s = ptySessions.get(args.sessionId)
  if (s) {
    try { s.p.kill() } catch {}
    ptySessions.delete(args.sessionId)
  }
  return { ok: true }
})


// LLM streaming with provider adapter and cancel support
const providers: Record<string, ProviderAdapter> = { openai: OpenAIProvider, anthropic: AnthropicProvider, gemini: GeminiProvider }
const inflight = new Map<string, { cancel: () => void }>()


// Propose edits via provider with strict JSON schema output
function buildEditsSchemaPrompt() {
  return `You are a code editor agent. Propose edits strictly as JSON.\n\nReturn ONLY a JSON object with this shape (no prose, no markdown fences):\n{\n  "edits": [\n    { "type": "replaceOnce", "path": "relative/path/from/workspace.ext", "oldText": "...", "newText": "..." },\n    { "type": "insertAfterLine", "path": "relative/path/from/workspace.ext", "line": 42, "text": "..." },\n    { "type": "replaceRange", "path": "relative/path/from/workspace.ext", "start": 120, "end": 140, "text": "..." }\n  ]\n}\nRules:\n- Paths are relative to the workspace root.\n- Use smallest, precise edits.\n- Do not include explanations.`
}

function extractJsonObject(raw: string): any {
  const trimmed = raw.trim()
  // If wrapped in fences, try to extract
  const fence = /```\w*\n([\s\S]*?)```/m.exec(trimmed)
  const candidate = fence ? fence[1] : trimmed
  // Try parse directly, else fallback to first {...} block
  try { return JSON.parse(candidate) } catch {}
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    const sub = candidate.slice(first, last + 1)
    try { return JSON.parse(sub) } catch {}
  }
  throw new Error('Failed to parse JSON edits from model output')
}
// --- Intent Router (Auto) ---
function isEditIntentText(t: string): boolean {
  const s = (t || '').toLowerCase()
  const patterns: RegExp[] = [
    /\b(create|add|insert|write|overwrite|append)\b/,
    /\b(modify|update|change|replace|refactor|rename|move|delete)\b/,
    /\b(fix|patch|apply)\b/,
    /\b(import|export)\b/,
    /\.[a-z0-9]{1,6}\b/ // looks like a filename with extension
  ]
  return patterns.some(re => re.test(s))
}


function isPlanIntentText(t: string): boolean {
  const s = (t || '').toLowerCase()
  const patterns: RegExp[] = [
    /\b(plan|planning|roadmap|strategy|approach|design|proposal|rfc)\b/,
    /\b(implementation plan|migration plan|rollout plan|outline steps|how should we|what's the plan)\b/,
    /\b(break\s?down|milestones|acceptance criteria|estimate|estimation)\b/,
  ]
  return patterns.some(re => re.test(s))
}


// Helper to send debug logs to renderer
function sendDebugLog(level: 'info' | 'warning' | 'error', category: string, message: string, data?: any) {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
  wc?.send('debug:log', { level, category, message, data })
}

// Auto router (chat vs tools) registered once at startup
ipcMain.handle('llm:auto', async (_event, args: { requestId: string, messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, model?: string, provider?: string, tools?: string[], responseSchema?: any }) => {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
  const providerId = (args.provider || 'openai')
  sendDebugLog('info', 'Router', `Auto-routing request to ${providerId}`, { requestId: args.requestId, provider: providerId })
  const key = await getProviderKey(providerId)
  if (!key) {
    const missingMsg = providerId === 'anthropic' ? 'Missing Anthropic API key' : providerId === 'gemini' ? 'Missing Gemini API key' : 'Missing OpenAI API key'
    sendDebugLog('error', 'Router', missingMsg, { provider: providerId })
    wc?.send('llm:error', { requestId: args.requestId, error: missingMsg })
    return { ok: false }
  }
  const provider = providers[providerId]

  // Decide intent from last user turn (fallback to chat)
  const lastUser = [...args.messages].reverse().find(m => m.role === 'user')
  const wantsPlan = isPlanIntentText(lastUser?.content || '')
  const wantsEdits = !wantsPlan && isEditIntentText(lastUser?.content || '')
  const intent = wantsPlan ? 'PLAN' : wantsEdits ? 'TOOLS (edit intent)' : 'CHAT'
  sendDebugLog('info', 'Router', `Intent detection: ${intent}`, {
    hasAgentStream: !!provider.agentStream,
    lastUserMessage: lastUser?.content?.slice(0, 100)
  })

  // Planning intent branch: run a planning conversation (no tools, no edits)
  if (isPlanIntentText(lastUser?.content || '')) {
    try {
      const lastUser2 = [...args.messages].reverse().find(m => m.role === 'user')
      const injected = await buildContextMessages(lastUser2?.content || '', 6)
      if (injected.length) args.messages = [...injected, ...args.messages]
    } catch {}

    const model = args.model || 'gpt-5'
    const systemMsg = { role: 'system' as const, content: buildPlanningPrompt() }
    const routed = [systemMsg, ...args.messages]

    try {
      const handle = await provider.chatStream({
        apiKey: key,
        model,
        messages: routed,
        onChunk: (text) => wc?.send('llm:chunk', { requestId: args.requestId, content: text }),
        onDone: () => wc?.send('llm:done', { requestId: args.requestId }),
        onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
        onTokenUsage: (usage) => wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage }),
      })
      inflight.set(args.requestId, handle)
      return { ok: true, mode: 'plan' }
    } catch (e: any) {
      wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
      return { ok: false }
    }
  }


  if (wantsEdits && provider.agentStream) {
    sendDebugLog('info', 'Agent', 'Using agent mode with tools', { toolCount: agentTools.length })
    // Use the same tool selection as agentStart
    const names = Array.isArray(args.tools) && args.tools.length ? new Set(args.tools) : null
    const selectedTools = agentTools.filter(t => !names || names.has(t.name))

    // Prepend tool-usage instruction and retrieval context (reuse logic from agentStart)
    const systemMsg = { role: 'system' as const, content: buildSystemPrompt(true) }
    let routed = [systemMsg, ...args.messages]


      // Override with centralized context injection to avoid duplicate logic
      {
        const lastUser2 = [...args.messages].reverse().find(m => m.role === 'user')
        const injected2 = await buildContextMessages(lastUser2?.content || '', 6)
        routed = [...injected2, ...[systemMsg, ...args.messages]]
      }

    const model = args.model || 'gpt-5'
    try {
      sendDebugLog('info', 'Agent', `Starting agent stream with ${selectedTools.length} tools`)
      let buffer = ''
      const handle = await provider.agentStream({
        apiKey: key,
        model,
        messages: routed,
        tools: selectedTools,
        responseSchema: args.responseSchema,
        toolMeta: { requestId: args.requestId },
        onChunk: (text) => { buffer += text; wc?.send('llm:chunk', { requestId: args.requestId, content: text }) },
        onDone: async () => {
          sendDebugLog('info', 'Agent', 'Agent stream completed')
          // Attempt strict edits auto-apply if JSON object returned
          try {
            const obj = extractJsonObject(buffer)
            const edits = Array.isArray(obj?.edits) ? obj.edits : []
            if (edits.length) {
              sendDebugLog('info', 'Edits', `Auto-applying ${edits.length} edits from response`)
              const res = await applyFileEditsInternal(edits, { verify: true })
              const summary = `\n\n[applied] edits=${res.applied} changed=${res.results.filter(r=>r.changed).length} tsc=${res.verification?.ok? 'ok':'fail'}`
              wc?.send('llm:chunk', { requestId: args.requestId, content: summary })
              wc?.send('agent:edits-applied', { requestId: args.requestId, ...res })
              sendDebugLog('info', 'Edits', `Applied ${res.applied} edits, ${res.results.filter(r=>r.changed).length} files changed`)
            }
          } catch {}
          wc?.send('llm:done', { requestId: args.requestId })
        },
        onError: (error) => {
          sendDebugLog('error', 'Agent', `Agent stream error: ${error}`)
          wc?.send('llm:error', { requestId: args.requestId, error })
        },
        onTokenUsage: (usage) => {
          const session = getOrCreateSession(args.requestId)
          session.cumulativeTokens += usage.totalTokens
          session.iterationCount++
          const tokenBudget = session.assessment?.token_budget || 50000
          const maxIterations = session.assessment?.max_iterations || 10
          wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage })
          wc?.send('agent:metrics', {
            requestId: args.requestId,
            tokensUsed: session.cumulativeTokens,
            tokenBudget,
            iterationsUsed: session.iterationCount,
            maxIterations,
            percentageUsed: Math.round((session.cumulativeTokens / tokenBudget) * 1000) / 10
          })
        },
      })
      inflight.set(args.requestId, handle)
      return { ok: true, mode: 'tools' }
    } catch (e: any) {
      sendDebugLog('error', 'Agent', `Failed to start agent stream: ${e?.message || String(e)}`)
      wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
      return { ok: false }
    }
  }

  // Otherwise, free-form chat (with tools if provider supports it)
  // Add project context and search results
  try {
    const lastUser = [...args.messages].reverse().find(m => m.role === 'user')
    const injected = await buildContextMessages(lastUser?.content || '', 6)
    if (injected.length) args.messages = [...injected, ...args.messages]
  } catch {}

  const model = args.model || 'gpt-5'

  // Use agentStream with tools if provider supports it (enables file reading in chat mode)
  if (provider.agentStream) {
    const names = Array.isArray(args.tools) && args.tools.length ? new Set(args.tools) : null
    const selectedTools = agentTools.filter(t => !names || names.has(t.name))

    try {
      const handle = await provider.agentStream({
        apiKey: key,
        model,
        messages: args.messages,
        tools: selectedTools,
        responseSchema: args.responseSchema,
        toolMeta: { requestId: args.requestId },
        onChunk: (text) => wc?.send('llm:chunk', { requestId: args.requestId, content: text }),
        onDone: () => wc?.send('llm:done', { requestId: args.requestId }),
        onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
        onTokenUsage: (usage) => {
          const session = getOrCreateSession(args.requestId)
          session.cumulativeTokens += usage.totalTokens
          session.iterationCount++
          const tokenBudget = session.assessment?.token_budget || 50000
          const maxIterations = session.assessment?.max_iterations || 10
          wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage })
          wc?.send('agent:metrics', {
            requestId: args.requestId,
            tokensUsed: session.cumulativeTokens,
            tokenBudget,
            iterationsUsed: session.iterationCount,
            maxIterations,
            percentageUsed: Math.round((session.cumulativeTokens / tokenBudget) * 1000) / 10
          })
        },
      })
      inflight.set(args.requestId, handle)
      return { ok: true, mode: 'chat' }
    } catch (e: any) {
      wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
      return { ok: false }
    }
  }

  // Fallback to basic chat stream if no tool support
  try {
    const handle = await provider.chatStream({
      apiKey: key,
      model,
      messages: args.messages,
      onChunk: (text) => wc?.send('llm:chunk', { requestId: args.requestId, content: text }),
      onDone: () => wc?.send('llm:done', { requestId: args.requestId }),
      onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
      onTokenUsage: (usage) => wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage }),
    })
    inflight.set(args.requestId, handle)
    return { ok: true, mode: 'chat' }
  } catch (e: any) {
    wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
    return { ok: false }
  }
})

// Agent-mode LLM streaming with provider-native tools
ipcMain.handle('llm:agentStart', async (_event, args: { requestId: string, messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, model?: string, provider?: string, tools?: string[], responseSchema?: any }) => {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
  const providerId = (args.provider || 'openai')
  sendDebugLog('info', 'Agent', `Starting agent mode with ${providerId}`, { requestId: args.requestId, provider: providerId })
  const key = await getProviderKey(providerId)
  if (!key) {
    const missingMsg = providerId === 'anthropic' ? 'Missing Anthropic API key' : providerId === 'gemini' ? 'Missing Gemini API key' : 'Missing OpenAI API key'
    sendDebugLog('error', 'Agent', missingMsg, { provider: providerId })
    wc?.send('llm:error', { requestId: args.requestId, error: missingMsg })
    return { ok: false }
  }

  const provider = providers[providerId]
  if (!provider?.agentStream) {
    // Fallback to basic chat if agent mode is not implemented for this provider yet
    wc?.send('llm:chunk', { requestId: args.requestId, content: '[note] Agent mode not available for this provider; falling back to chat.\n' })
    try {
      const model = args.model || 'gpt-5'
      let buffer = ''
      const handle = await provider.chatStream({
        apiKey: key,
        model,
        messages: args.messages,
        onChunk: (t) => { buffer += t; wc?.send('llm:chunk', { requestId: args.requestId, content: t }) },
        onDone: () => wc?.send('llm:done', { requestId: args.requestId }),
        onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
        onTokenUsage: (usage) => wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage }),
      })
      inflight.set(args.requestId, handle)
      return { ok: true }
    } catch (e: any) {
      wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
      return { ok: false }
    }
  }

  // Select tools to expose; default to full set for file work
  const names = Array.isArray(args.tools) && args.tools.length ? new Set(args.tools) : null
  const selectedTools = agentTools.filter(t => !names || names.has(t.name))

  // Augment messages with project context and index search results
  try {
    const lastUser = [...args.messages].reverse().find(m => m.role === 'user')
    const injected = await buildContextMessages(lastUser?.content || '', 6)
    if (injected.length) args.messages = [...injected, ...args.messages]
  } catch {}

  const model = args.model || 'gpt-5'

  // Prepend a system instruction to actually use tools for file changes
  const systemMsg = { role: 'system' as const, content: buildSystemPrompt(true) }
  args.messages = [systemMsg, ...args.messages]

  try {
    sendDebugLog('info', 'Agent', `Starting agent stream with ${selectedTools.length} tools available`)
    let buffer = ''
    const handle = await provider.agentStream!({
      apiKey: key,
      model,
      messages: args.messages,
      tools: selectedTools,
      responseSchema: args.responseSchema,
      toolMeta: { requestId: args.requestId },
      onChunk: (text) => { buffer += text; wc?.send('llm:chunk', { requestId: args.requestId, content: text }) },
      onDone: async () => {
        sendDebugLog('info', 'Agent', 'Agent stream completed')
        // If the model returned structured edits JSON instead of calling tools, try to apply it automatically
        try {
          const obj = extractJsonObject(buffer)
          const edits = Array.isArray(obj?.edits) ? obj.edits : []
          if (edits.length) {
            sendDebugLog('info', 'Edits', `Applying ${edits.length} edits from structured response`)
            const res = await applyFileEditsInternal(edits, { verify: true })
            const summary = `\n\n[applied] edits=${res.applied} changed=${res.results.filter(r=>r.changed).length} tsc=${res.verification?.ok? 'ok':'fail'}`
            wc?.send('llm:chunk', { requestId: args.requestId, content: summary })
            wc?.send('agent:edits-applied', { requestId: args.requestId, ...res })
            sendDebugLog('info', 'Edits', `Applied ${res.applied} edits, ${res.results.filter(r=>r.changed).length} files changed`)
          }
        } catch {}
        wc?.send('llm:done', { requestId: args.requestId })
      },
      onError: (error) => {
        sendDebugLog('error', 'Agent', `Agent stream error: ${error}`)
        wc?.send('llm:error', { requestId: args.requestId, error })
      },
      onTokenUsage: (usage) => {
        const session = getOrCreateSession(args.requestId)
        session.cumulativeTokens += usage.totalTokens
        session.iterationCount++
        const tokenBudget = session.assessment?.token_budget || 50000
        const maxIterations = session.assessment?.max_iterations || 10
        wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage })
        wc?.send('agent:metrics', {
          requestId: args.requestId,
          tokensUsed: session.cumulativeTokens,
          tokenBudget,
          iterationsUsed: session.iterationCount,
          maxIterations,
          percentageUsed: Math.round((session.cumulativeTokens / tokenBudget) * 1000) / 10
        })
      },
    })
    inflight.set(args.requestId, handle)
    return { ok: true }
  } catch (e: any) {
    sendDebugLog('error', 'Agent', `Failed to start agent stream: ${e?.message || String(e)}`)
    wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
    return { ok: false }
  }
})


ipcMain.handle('edits:propose', async (_e, args: { instruction: string; model?: string; provider?: string; k?: number }) => {
  const providerId = (args.provider || 'openai')
  const key = await getProviderKey(providerId)

  if (!key) return { ok: false, error: 'Missing API key for provider' }
  const model = args.model || (providerId === 'anthropic' ? 'claude-3-5-sonnet' : providerId === 'gemini' ? 'gemini-1.5-pro' : 'gpt-5')
  const provider = providers[providerId]

  // Build messages with context
  const messages: Array<{ role: 'system'|'user'|'assistant'; content: string }> = []
  messages.push({ role: 'system', content: buildEditsSchemaPrompt() })
  try {
    const res = await getIndexer().search(args.instruction.slice(0, 2000), args.k ?? 6)
    if (res?.chunks?.length) {
      const ctx = res.chunks.map((c) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text||'').slice(0, 600)}`).join('\n\n')
      messages.push({ role: 'user', content: `Context from repository (top matches):\n\n${ctx}\n\nUse this context if helpful.` })
    }
  } catch {}
  messages.push({ role: 'user', content: `Instruction:\n${args.instruction}\n\nReturn ONLY the JSON object, nothing else.` })

  let buffer = ''
  const handle = await provider.chatStream({
    apiKey: key,
    model,
    messages,
    onChunk: (t) => { buffer += t },
    onDone: () => { /* no-op */ },
    onError: (_e) => { /* no-op */ },
  })
  // Wait briefly for stream to complete (best-effort)
  await new Promise((r) => setTimeout(r, 300))
  // Give a little more time if we haven't seen a closing brace yet (up to ~2s total)
  const start = Date.now()
  while (!buffer.includes('}') && Date.now() - start < 1700) {
    await new Promise((r) => setTimeout(r, 50))
  }
  // Cancel any lingering stream
  try { handle.cancel() } catch {}

  try {
    const obj = extractJsonObject(buffer)
    const edits = Array.isArray(obj?.edits) ? obj.edits : []
    return { ok: true, edits }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), raw: buffer }
  }
})

ipcMain.handle('llm:start', async (_event, args: { requestId: string, messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, model?: string, provider?: string }) => {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
  const providerId = (args.provider || 'openai')
  sendDebugLog('info', 'LLM', `Starting chat with ${providerId}`, { requestId: args.requestId, provider: providerId })
  const key = await getProviderKey(providerId)
  if (!key) {
    const missingMsg = providerId === 'anthropic' ? 'Missing Anthropic API key' : providerId === 'gemini' ? 'Missing Gemini API key' : 'Missing OpenAI API key'
    sendDebugLog('error', 'LLM', missingMsg, { provider: providerId })
    wc?.send('llm:error', { requestId: args.requestId, error: missingMsg })
    return { ok: false }
  }

  // Encourage actionable responses: if proposing code changes, return JSON-only {edits:[...]} per schema
  args.messages = [
    { role: 'system', content: 'You can directly edit files. When you decide to change code, respond with ONLY a JSON object of the form {"edits":[{ "type":"replaceOnce"|"insertAfterLine"|"replaceRange", ... }]} using workspace-relative paths. Otherwise, reply normally.' },
    ...args.messages,
  ]
  const provider = providers[providerId]
  // Augment messages with project context and index search results
  try {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const injected = await buildContextMessages(lastUser?.content || '', 6)
    if (injected.length) args.messages = [...injected, ...args.messages]
  } catch (e) {
    // best-effort; ignore retrieval errors
  }

  const model = args.model || 'gpt-5'
  try {
    let buffer = ''
    const handle = await provider.chatStream({
      apiKey: key,
      model,
      messages: args.messages,
      onChunk: (text) => { buffer += text; wc?.send('llm:chunk', { requestId: args.requestId, content: text }) },
      onDone: async () => {
        // Attempt to detect and auto-apply edits returned as JSON
        try {
          const obj = extractJsonObject(buffer)
          const edits = Array.isArray(obj?.edits) ? obj.edits : []
          if (edits.length) {
            const res = await applyFileEditsInternal(edits, { verify: true })
            // Stream a compact summary into the chat before done
            const summary = `\n\n[applied] edits=${res.applied} changed=${res.results.filter(r=>r.changed).length} tsc=${res.verification?.ok? 'ok':'fail'}`
            wc?.send('llm:chunk', { requestId: args.requestId, content: summary })
            wc?.send('agent:edits-applied', { requestId: args.requestId, ...res })
          }
        } catch { /* not JSON edits; ignore */ }
        wc?.send('llm:done', { requestId: args.requestId })
      },
      onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
      onTokenUsage: (usage) => wc?.send('llm:token-usage', { requestId: args.requestId, provider: providerId, model, usage }),
    })
    inflight.set(args.requestId, handle)
    return { ok: true }
  } catch (e: any) {
    wc?.send('llm:error', { requestId: args.requestId, error: e?.message || String(e) })
    return { ok: false }
  }
})

ipcMain.handle('llm:cancel', async (_event, args: { requestId: string }) => {
  const handle = inflight.get(args.requestId)
  try {
    handle?.cancel()
  } finally {
    inflight.delete(args.requestId)
  }
  return { ok: true }
})

// Window state management
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

function getDefaultWindowState(): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // Default to 1200x800, or 80% of screen size if smaller
  const defaultWidth = Math.min(1200, Math.floor(screenWidth * 0.8))
  const defaultHeight = Math.min(800, Math.floor(screenHeight * 0.8))

  // Center the window
  const x = Math.floor((screenWidth - defaultWidth) / 2)
  const y = Math.floor((screenHeight - defaultHeight) / 2)

  return {
    width: defaultWidth,
    height: defaultHeight,
    x,
    y,
    isMaximized: false,
  }
}

function validateWindowState(state: WindowState): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // Minimum window size
  const minWidth = 800
  const minHeight = 600

  // Validate dimensions
  let width = Math.max(minWidth, Math.min(state.width, screenWidth))
  let height = Math.max(minHeight, Math.min(state.height, screenHeight))

  // Validate position - ensure window is visible on screen
  let x = state.x
  let y = state.y

  if (x !== undefined && y !== undefined) {
    // Check if window is on any available display
    const displays = screen.getAllDisplays()
    let isVisible = false

    for (const display of displays) {
      const { x: dx, y: dy, width: dw, height: dh } = display.bounds
      // Check if at least part of the window title bar would be visible
      if (
        x + width > dx &&
        x < dx + dw &&
        y + 50 > dy && // At least 50px of title bar visible
        y < dy + dh
      ) {
        isVisible = true
        break
      }
    }

    // If not visible on any display, reset to centered on primary display
    if (!isVisible) {
      x = Math.floor((screenWidth - width) / 2)
      y = Math.floor((screenHeight - height) / 2)
    }
  } else {
    // No position saved, center on primary display
    x = Math.floor((screenWidth - width) / 2)
    y = Math.floor((screenHeight - height) / 2)
  }

  return {
    width,
    height,
    x,
    y,
    isMaximized: state.isMaximized || false,
  }
}

function loadWindowState(): WindowState {
  try {
    const saved = windowStateStore.get('windowState') as WindowState | undefined
    if (saved) {
      console.log('[main] Loaded window state:', saved)
      return validateWindowState(saved)
    }
  } catch (e) {
    console.error('[main] Failed to load window state:', e)
  }

  const defaultState = getDefaultWindowState()
  console.log('[main] Using default window state:', defaultState)
  return defaultState
}

function saveWindowState() {
  if (!win) return

  try {
    // Don't save size if maximized, only save the maximized state
    const isMaximized = win.isMaximized()

    if (isMaximized) {
      // Only update the maximized flag, keep previous size
      const current = windowStateStore.get('windowState') as WindowState | undefined
      windowStateStore.set('windowState', {
        ...current,
        isMaximized: true,
      })
    } else {
      const bounds = win.getBounds()
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: false,
      }
      windowStateStore.set('windowState', state)
    }
  } catch (e) {
    console.error('[main] Failed to save window state:', e)
  }
}

// Debounce helper for window state saving
let saveWindowStateTimeout: NodeJS.Timeout | null = null
function debouncedSaveWindowState() {
  if (saveWindowStateTimeout) {
    clearTimeout(saveWindowStateTimeout)
  }
  saveWindowStateTimeout = setTimeout(() => {
    saveWindowState()
    saveWindowStateTimeout = null
  }, 500)
}

function createWindow() {
  // Load saved window state
  const windowState = loadWindowState()

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'hifide-logo.png'),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#1e1e1e',
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      preload: path.join(DIRNAME, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Restore maximized state if needed
  if (windowState.isMaximized) {
    win.maximize()
  }

  // Set up window state tracking
  win.on('resize', debouncedSaveWindowState)
  win.on('move', debouncedSaveWindowState)
  win.on('maximize', saveWindowState)
  win.on('unmaximize', saveWindowState)

  // Save state before closing
  win.on('close', () => {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout)
    }
    saveWindowState()
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)

    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Window control IPC
ipcMain.handle('window:minimize', () => { win?.minimize() })
ipcMain.handle('window:maximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized() })
ipcMain.handle('window:close', () => { win?.close() })
ipcMain.handle('window:isMaximized', () => win?.isMaximized())

let currentViewForMenu: 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings' = 'agent'
const menuRefs: { file?: Electron.Menu; edit?: Electron.Menu; view?: Electron.Menu; window?: Electron.Menu; help?: Electron.Menu } = {}

function buildMenu() {
  const isMac = process.platform === 'darwin'

  // Get recent folders from window state store
  let recentFolders: Array<{ path: string; lastOpened: number }> = []
  try {
    const stored = windowStateStore.get('recentFolders')
    if (Array.isArray(stored)) {
      recentFolders = stored.slice(0, 10)
    }
  } catch {}

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }]: []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
            wc?.send('menu:open-folder')
          },
        },
        {
          label: 'Open Recent',
          submenu: recentFolders.length > 0
            ? [
                ...recentFolders.map(folder => ({
                  label: folder.path,
                  click: () => {
                    const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
                    wc?.send('menu:open-recent-folder', folder.path)
                  },
                })),
                { type: 'separator' as const },
                {
                  label: 'Clear Recently Opened',
                  click: () => {
                    const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
                    wc?.send('menu:clear-recent-folders')
                  },
                },
              ]
            : [{ label: 'No Recent Folders', enabled: false }],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Chat',
          accelerator: isMac ? 'Cmd+1' : 'Ctrl+1',
          click: () => { const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents; wc?.send('menu:open-chat') },
        },
        {
          label: 'Settings',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => { const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents; wc?.send('menu:open-settings') },
        },
        {
          label: 'Toggle Terminal Panel',
          accelerator: isMac ? 'Cmd+`' : 'Ctrl+`',
          enabled: currentViewForMenu === 'explorer',
          click: () => { const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents; wc?.send('menu:toggle-terminal-panel') },
        },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu' as const,
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => { await shell.openExternal('https://electronjs.org') },
        },
      ],
    },
  ]
  const appMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(appMenu)
  // cache submenus for popup (Windows/Linux). On macOS we still allow popup for consistency.
  const items = appMenu.items
  menuRefs.file = items.find(i => i.label === 'File')?.submenu || menuRefs.file
  menuRefs.edit = items.find(i => i.label === 'Edit')?.submenu || menuRefs.edit
  menuRefs.view = items.find(i => i.label === 'View')?.submenu || menuRefs.view
  menuRefs.window = items.find(i => i.role === 'windowMenu')?.submenu || items.find(i => i.label === 'Window')?.submenu || menuRefs.window
  menuRefs.help = items.find(i => i.label === 'Help')?.submenu || menuRefs.help
}

ipcMain.handle('menu:popup', (_e, args: { menu: 'file'|'edit'|'view'|'window'|'help', x?: number, y?: number }) => {
  const m = menuRefs[args.menu]
  if (!win || !m) return
  // Position menu below the menu item
  if (args.x !== undefined && args.y !== undefined) {
    m.popup({ window: win, x: Math.round(args.x), y: Math.round(args.y) })
  } else {
    m.popup({ window: win })
  }
})

// Update menu item enablement when renderer view changes
ipcMain.handle('app:set-view', (_e, view: 'agent'|'explorer'|'sourceControl'|'terminal'|'settings') => {
  currentViewForMenu = view
  const appMenu = Menu.getApplicationMenu()
  const viewMenu = appMenu?.items.find(i => i.label === 'View')?.submenu
  const toggleItem = viewMenu?.items.find(i => i.label === 'Toggle Terminal Panel')
  if (toggleItem) toggleItem.enabled = view === 'explorer'
})

// Workspace bootstrap helpers and IPC
async function pathExists(p: string) {
  try { await fs.access(p); return true } catch { return false }
}
async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }) }
async function isGitRepo(dir: string) {
  try {
    const { stdout } = await exec('git rev-parse --is-inside-work-tree', { cwd: dir })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}
async function ensureGitIgnoreHasPrivate(baseDir: string) {
  const giPath = path.join(baseDir, '.gitignore')
  let text = ''
  try { text = await fs.readFile(giPath, 'utf-8') } catch { text = '' }
  if (text.includes('.hifide-private')) return false
  const add = `${text && !text.endsWith('\n') ? '\n' : ''}# Hifide\n.hifide-private\n`
  await atomicWrite(giPath, text + add)
  return true
}

async function generateContextPack(baseDir: string, preferAgent?: boolean, overwrite?: boolean): Promise<boolean> {
  const publicDir = path.join(baseDir, '.hifide-public')
  await ensureDir(publicDir)
  const ctxJson = path.join(publicDir, 'context.json')
  const ctxMd = path.join(publicDir, 'context.md')
  if (!overwrite && await pathExists(ctxJson)) return false

  // Deterministic scan
  const pkgPath = path.join(baseDir, 'package.json')
  let pkg: any = {}
  try { pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) } catch {}
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
  for (const [key, rel] of docFiles) { if (await has(rel)) docs[key] = rel }
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
  for (const [k, rel] of entries) { if (await has(rel)) entryPoints[k] = rel }

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
      const provider = (providers as any)[sel.id] as ProviderAdapter
      const model = sel.id === 'anthropic' ? 'claude-3-5-sonnet' : sel.id === 'gemini' ? 'gemini-1.5-pro' : 'gpt-5'
      // Read a few high-signal files to feed the model safely (bounded size)
      const readText = async (rel: string) => { try { return (await fs.readFile(path.join(baseDir, rel), 'utf-8')).slice(0, 6000) } catch { return '' } }
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
            if (Array.isArray(extra.goals)) context.goals = Array.from(new Set([...(context.goals||[]), ...extra.goals]))
            if (typeof extra.summary === 'string') context.summary = extra.summary
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

// Workspace root management
ipcMain.handle('workspace:get-root', async () => {
  return process.env.APP_ROOT || process.cwd()
})

ipcMain.handle('workspace:set-root', async (_e, newRoot: string) => {
  const t0 = performance.now()
  console.log('[Main] workspace:set-root starting...')
  try {
    const t1 = performance.now()
    const resolved = path.resolve(newRoot)
    // Verify the directory exists
    await fs.access(resolved)
    console.log(`[Main] Verify directory: ${(performance.now() - t1).toFixed(2)}ms`)

    // Update APP_ROOT
    const t2 = performance.now()
    process.env.APP_ROOT = resolved
    console.log(`[Main] Update APP_ROOT: ${(performance.now() - t2).toFixed(2)}ms`)

    // Reinitialize indexer with new root
    const t3 = performance.now()
    indexer = null
    getIndexer()
    console.log(`[Main] Reinitialize indexer: ${(performance.now() - t3).toFixed(2)}ms`)

    console.log(`[Main] workspace:set-root TOTAL: ${(performance.now() - t0).toFixed(2)}ms`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

// Remove any existing handler first to prevent duplicates during hot reload
ipcMain.removeHandler('workspace:open-folder-dialog')
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

// Sync recent folders from renderer to window state store and rebuild menu
ipcMain.on('workspace:recent-folders-changed', (_e, recentFolders: Array<{ path: string; lastOpened: number }>) => {
  try {
    windowStateStore.set('recentFolders', recentFolders)
  } catch (e) {
    console.error('Failed to save recent folders:', e)
  }
  buildMenu()
})

ipcMain.handle('workspace:bootstrap', async (_e, args: { baseDir?: string; preferAgent?: boolean; overwrite?: boolean }) => {
  try {
    const baseDir = path.resolve(String(args?.baseDir || process.env.APP_ROOT || process.cwd()))
    const publicDir = path.join(baseDir, '.hifide-public')
    const privateDir = path.join(baseDir, '.hifide-private')
    let createdPublic = false
    let createdPrivate = false
    let ensuredGitIgnore = false
    let generatedContext = false

    if (!(await pathExists(publicDir))) { await ensureDir(publicDir); createdPublic = true }
    if (!(await pathExists(privateDir))) { await ensureDir(privateDir); createdPrivate = true }

    if (await isGitRepo(baseDir)) {
      try { ensuredGitIgnore = await ensureGitIgnoreHasPrivate(baseDir) } catch {}
    }

    try { generatedContext = await generateContextPack(baseDir, !!args?.preferAgent, !!args?.overwrite) } catch {}

    return { ok: true, createdPublic, createdPrivate, ensuredGitIgnore, generatedContext }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

// Planning: save/load ApprovedPlan in .hifide-private
ipcMain.handle('planning:save-approved', async (_e, plan: any) => {
  try {
    const baseDir = path.resolve(String(process.env.APP_ROOT || process.cwd()))
    const privateDir = path.join(baseDir, '.hifide-private')
    await ensureDir(privateDir)
    const file = path.join(privateDir, 'approved-plan.json')
    await atomicWrite(file, JSON.stringify(plan ?? {}, null, 2))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})

ipcMain.handle('planning:load-approved', async () => {
  try {
    const baseDir = path.resolve(String(process.env.APP_ROOT || process.cwd()))
    const file = path.join(baseDir, '.hifide-private', 'approved-plan.json')
    const text = await fs.readFile(file, 'utf-8').catch(() => '')
    if (!text) return { ok: true, plan: null }
    try { return { ok: true, plan: JSON.parse(text) } } catch { return { ok: true, plan: null } }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})


app.whenReady().then(() => { createWindow(); buildMenu() })
