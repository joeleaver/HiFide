import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import keytar from 'keytar'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'
import type { ProviderAdapter, AgentTool } from './providers/provider'
import { createRequire } from 'node:module'
// Load CJS pty at runtime to avoid bundling and __dirname issues
const require = createRequire(import.meta.url)
// lazy-require pty module inside create handler to allow fallback when Electron prebuild is missing
import { randomUUID } from 'node:crypto'
import { spawn as spawnChild } from 'node:child_process'

// PTY helper (Node runtime) fallback for Windows when Electron prebuild is missing
let ptyHelperProc: import('node:child_process').ChildProcessWithoutNullStreams | null = null
let ptyHelperBuf = ''
const ptyHelperPending = new Map<string, (payload: any) => void>()
function helperSend(obj: any) { try { ptyHelperProc?.stdin.write(JSON.stringify(obj) + '\n') } catch {} }
function ensurePtyHelper() {
  if (ptyHelperProc && !ptyHelperProc.killed) return
  // Resolve helper relative to project root in dev
  const helperPath = path.resolve(process.cwd(), 'electron', 'pty-helper.cjs')
  ptyHelperProc = spawnChild('node', [helperPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  ptyHelperProc.stdout.on('data', (chunk) => {
    ptyHelperBuf += chunk.toString('utf8')
    let idx
    while ((idx = ptyHelperBuf.indexOf('\n')) >= 0) {
      const line = ptyHelperBuf.slice(0, idx); ptyHelperBuf = ptyHelperBuf.slice(idx + 1)
      if (!line.trim()) continue
      let msg: any; try { msg = JSON.parse(line) } catch { continue }
      if (msg.reqId && ptyHelperPending.has(msg.reqId)) { const res = ptyHelperPending.get(msg.reqId)!; ptyHelperPending.delete(msg.reqId); res(msg); continue }
      // Forward PTY stream events to renderers
      if (msg.type === 'data' && msg.sessionId) {
        const s = ptySessions.get(msg.sessionId)
        if (s) {
          const { redacted, bytesRedacted } = redactOutput(msg.data || '')
          if (bytesRedacted > 0) { logEvent(msg.sessionId, 'data_redacted', { bytesRedacted }).catch(() => {}) }
          const wc = BrowserWindow.fromId(s.wcId)?.webContents
          try { wc?.send('pty:data', { sessionId: msg.sessionId, data: redacted }) } catch {}
        }
      } else if (msg.type === 'exit' && msg.sessionId) {
        const s = ptySessions.get(msg.sessionId)
        if (s) {
          const wc = BrowserWindow.fromId(s.wcId)?.webContents
          try { wc?.send('pty:exit', { sessionId: msg.sessionId, exitCode: msg.exitCode ?? -1 }) } catch {}
          logEvent(msg.sessionId, 'session_exit', { exitCode: msg.exitCode ?? -1 }).catch(() => {})
          ptySessions.delete(msg.sessionId)
        }
      }
    }
  })
}


import { renameSymbol as tsRenameSymbol, organizeImports as tsOrganizeImports, verifyTypecheck as tsVerify, addNamedExport as tsAddNamedExport, moveFileWithImports as tsMoveFile, ensureDefaultExport as tsEnsureDefault, addNamedExportFrom as tsAddExportFrom, extractFunction as tsExtractFunction, suggestParams as tsSuggestParams, inlineVariable as tsInlineVar, inlineFunction as tsInlineFn, convertDefaultToNamed as tsDefaultToNamed, convertNamedToDefault as tsNamedToDefault } from './refactors/ts'


import { Indexer } from './indexing/indexer'

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

const SERVICE_NAME = 'HiFide'
const ACCOUNT_OPENAI_KEY = 'openai_api_key'
const ACCOUNT_ANTHROPIC_KEY = 'anthropic_api_key'
const ACCOUNT_GEMINI_KEY = 'gemini_api_key'


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

async function logEvent(sessionId: string, type: string, payload: any) {
  try {
    await ensureLogsDir()
    const entry = { ts: new Date().toISOString(), sessionId, type, ...payload }
    await fs.appendFile(path.join(logsRoot(), `${sessionId}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8')
  } catch {}
}


// Secure secret storage IPC handlers
ipcMain.handle('secrets:set', async (_e, k: string) => {
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_OPENAI_KEY, k)
  return true
})


// Provider-specific secret APIs
ipcMain.handle('secrets:setFor', async (_e, args: { provider: string; key: string }) => {
  const acc = args.provider === 'anthropic' ? ACCOUNT_ANTHROPIC_KEY : args.provider === 'gemini' ? ACCOUNT_GEMINI_KEY : ACCOUNT_OPENAI_KEY
  await keytar.setPassword(SERVICE_NAME, acc, args.key)
  return true
})

ipcMain.handle('secrets:getFor', async (_e, provider: string) => {
  const acc = provider === 'anthropic' ? ACCOUNT_ANTHROPIC_KEY : provider === 'gemini' ? ACCOUNT_GEMINI_KEY : ACCOUNT_OPENAI_KEY
  return keytar.getPassword(SERVICE_NAME, acc)
})


// Helper: get provider API key with env fallback for dev
async function getProviderKey(providerId: string): Promise<string | null> {
  const account = providerId === 'anthropic' ? ACCOUNT_ANTHROPIC_KEY : providerId === 'gemini' ? ACCOUNT_GEMINI_KEY : ACCOUNT_OPENAI_KEY
  const stored = await keytar.getPassword(SERVICE_NAME, account)
  if (stored && stored.trim()) return stored
  const env = process.env
  if (providerId === 'openai' && env?.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (providerId === 'anthropic' && env?.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY
  if (providerId === 'gemini' && env?.GEMINI_API_KEY) return env.GEMINI_API_KEY
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
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const g = new GoogleGenerativeAI(key)
      const m = g.getGenerativeModel({ model: model || 'gemini-1.5-pro' }) as any
      await m.countTokens({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
      return { ok: true }
    }
    return { ok: false, error: 'Unknown provider' }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
})


// Presence check: keytar OR env vars indicate a provider is available
ipcMain.handle('secrets:presence', async () => {
  const env = process.env
  const hasOpenAI = !!(await keytar.getPassword(SERVICE_NAME, ACCOUNT_OPENAI_KEY)) || !!env?.OPENAI_API_KEY
  const hasAnthropic = !!(await keytar.getPassword(SERVICE_NAME, ACCOUNT_ANTHROPIC_KEY)) || !!env?.ANTHROPIC_API_KEY
  const hasGemini = !!(await keytar.getPassword(SERVICE_NAME, ACCOUNT_GEMINI_KEY)) || !!env?.GEMINI_API_KEY || !!env?.GOOGLE_API_KEY
  return { openai: hasOpenAI, anthropic: hasAnthropic, gemini: hasGemini }
})


ipcMain.handle('secrets:get', async () => {
  return keytar.getPassword(SERVICE_NAME, ACCOUNT_OPENAI_KEY)
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
  const walk = async (dirPath: string) => {
    mkWatcher(dirPath)
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
  await walk(root)
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
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, filePath)
}

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
// Minimal set to read, edit, and write files, plus index search
const agentTools: AgentTool[] = [
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

    },
  },
]

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
    // Fallback: use node helper when Electron prebuild is missing (Windows conpty.node)
    const msg = e?.message || ''
    if (process.platform === 'win32' && (msg.includes('conpty.node') || msg.includes('MODULE_NOT_FOUND'))) {
      ensurePtyHelper()
      const reqId = randomUUID()
      const sessionId = await new Promise<string>((resolve) => {
        ptyHelperPending.set(reqId, (res: any) => resolve(res.sessionId))
        helperSend({ type: 'create', reqId, shell, cwd, cols, rows, env })
      })
      ptySessions.set(sessionId, {
        p: {
          pid: 0,
          onData: () => {},
          write: (d: string) => helperSend({ type: 'write', sessionId, data: d }),
          resize: (c: number, r: number) => helperSend({ type: 'resize', sessionId, cols: c, rows: r }),
          kill: () => helperSend({ type: 'dispose', sessionId }),
        },
        wcId: wc.id,
        log: opts.log !== false,
      })
      await logEvent(sessionId, 'session_create', { shell, cwd, cols, rows, via: 'helper' })
      return { sessionId }
    }
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
ipcMain.handle('index:rebuild', async () => {
  try {
    const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
    await getIndexer().rebuild((p) => { try { wc?.send('index:progress', p) } catch {} })
    // Begin watching for incremental changes after a successful rebuild
    try { getIndexer().startWatch((p) => { try { wc?.send('index:progress', p) } catch {} }) } catch {}
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
  if (s) s.p.write(args.data)
  return { ok: !!s }
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

// Agent-mode LLM streaming with provider-native tools
ipcMain.handle('llm:agentStart', async (_event, args: { requestId: string, messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, model?: string, provider?: string, tools?: string[], responseSchema?: any }) => {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
  const providerId = (args.provider || 'openai')
  const key = await getProviderKey(providerId)
  if (!key) {
    const missingMsg = providerId === 'anthropic' ? 'Missing Anthropic API key' : providerId === 'gemini' ? 'Missing Gemini API key' : 'Missing OpenAI API key'
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

  // Augment messages with index context (best-effort)
  try {
    const lastUser = [...args.messages].reverse().find(m => m.role === 'user')
    const query = lastUser?.content?.slice(0, 2000) || ''
    if (query) {
      const res = await getIndexer().search(query, 6)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text||'').slice(0, 600)}`).join('\n\n')
        args.messages = [{ role: 'user', content: `Context from the repository (top matches):\n\n${ctx}\n\nUse this context if relevant.` }, ...args.messages]
      }
    }
  } catch {}

  const model = args.model || 'gpt-5'

  // Prepend a system instruction to actually use tools for file changes
  const systemMsg = {
    role: 'system' as const,
    content:
      'You are a software agent with tools. When the user asks to change files (e.g., update README.md), you MUST make the changes using tools (fs.read_file, fs.write_file, edits.apply). Do not just describe changes. Read the current file, apply minimal precise edits, and write the updated file. After changes, briefly summarize what changed. Keep paths workspace-relative.'
  }
  args.messages = [systemMsg, ...args.messages]

  try {
    let buffer = ''
    const handle = await provider.agentStream!({
      apiKey: key,
      model,
      messages: args.messages,
      tools: selectedTools,
      responseSchema: args.responseSchema,
      onChunk: (text) => { buffer += text; wc?.send('llm:chunk', { requestId: args.requestId, content: text }) },
      onDone: async () => {
        // If the model returned structured edits JSON instead of calling tools, try to apply it automatically
        try {
          const obj = extractJsonObject(buffer)
          const edits = Array.isArray(obj?.edits) ? obj.edits : []
          if (edits.length) {
            const res = await applyFileEditsInternal(edits, { verify: true })
            const summary = `\n\n[applied] edits=${res.applied} changed=${res.results.filter(r=>r.changed).length} tsc=${res.verification?.ok? 'ok':'fail'}`
            wc?.send('llm:chunk', { requestId: args.requestId, content: summary })
            wc?.send('agent:edits-applied', { requestId: args.requestId, ...res })
          }
        } catch {}
        wc?.send('llm:done', { requestId: args.requestId })
      },
      onError: (error) => wc?.send('llm:error', { requestId: args.requestId, error }),
    })
    inflight.set(args.requestId, handle)
    return { ok: true }
  } catch (e: any) {
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
  const key = await getProviderKey(providerId)
  if (!key) {
    const missingMsg = providerId === 'anthropic' ? 'Missing Anthropic API key' : providerId === 'gemini' ? 'Missing Gemini API key' : 'Missing OpenAI API key'
    wc?.send('llm:error', { requestId: args.requestId, error: missingMsg })
    return { ok: false }
  // Encourage actionable responses: if proposing code changes, return JSON-only {edits:[...]} per schema
  args.messages = [
    { role: 'system', content: 'You can directly edit files. When you decide to change code, respond with ONLY a JSON object of the form {"edits":[{ "type":"replaceOnce"|"insertAfterLine"|"replaceRange", ... }]} using workspace-relative paths. Otherwise, reply normally.' },
    ...args.messages,
  ]

  }
  const provider = providers[providerId]
  // Augment messages with retrieved context (prefix as a user message)
  try {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const query = lastUser?.content?.slice(0, 2000) || ''
    if (query) {
      const res = await getIndexer().search(query, 6)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c) => {
          const snippet = (c.text || '').slice(0, 600)
          return `• ${c.path}:${c.startLine}-${c.endLine}\n${snippet}`
        }).join('\n\n')
        const ctxMsg = { role: 'user' as const, content: `Context from the repository (top matches):\n\n${ctx}\n\nUse this context if relevant.` }
        args.messages = [ctxMsg, ...args.messages]
      }
    }
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

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'hifide-logo.png'),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(DIRNAME, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }]: []),
    {
      label: 'File',
      submenu: [
        {
          label: isMac ? 'Preferences…' : 'Settings…',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || win?.webContents
            wc?.send('menu:open-settings')
          },
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

app.whenReady().then(() => { createWindow(); buildMenu() })
