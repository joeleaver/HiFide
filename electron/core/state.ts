/**
 * Shared application state for the Electron main process
 *
 * This module provides centralized state management for cross-cutting concerns
 * to prevent circular dependencies and make state access explicit.
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import path from 'node:path'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { Indexer } from '../indexing/indexer'
import { AnthropicAiSdkProvider } from '../providers-ai-sdk/anthropic'
import { GeminiAiSdkProvider } from '../providers-ai-sdk/gemini'
import { FireworksAiSdkProvider } from '../providers-ai-sdk/fireworks'
import { OpenAiSdkProvider } from '../providers-ai-sdk/openai'
import { XaiAiSdkProvider } from '../providers-ai-sdk/xai'
import { activeConnections, broadcastWorkspaceNotification } from '../backend/ws/broadcast'

import type { ProviderAdapter } from '../providers/provider'

/**
 * Main application window reference
 */
let mainWindow: BrowserWindow | null = null

/**
 * Get the main application window
 */
export function getWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Set the main application window
 */
export function setWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

/**
 * Get a focused or main window's WebContents
 */
export function getWebContents() {
  return BrowserWindow.getFocusedWindow()?.webContents || mainWindow?.webContents
}

/**
 * Window state store for persisting window size and position
 */
export const windowStateStore = new Store({
  name: 'hifide-window-state',
})

/**
 * Legacy secure store for migration purposes only
 * API keys are now stored in Zustand store (settingsApiKeys)
 */
const legacySecureStore = new Store({
  name: 'hifide-secrets',
  encryptionKey: 'hifide-local-encryption-key',
})

/**
 * Get provider API key from Zustand store or environment
 */
export async function getProviderKey(provider: string): Promise<string | null> {
  const { useMainStore } = await import('../store')
  const state = useMainStore.getState()

  // 1) Try Zustand store first (primary storage)
  const keys = state.settingsApiKeys
  if (keys) {
    if (provider === 'openai' && keys.openai?.trim()) return keys.openai
    if (provider === 'anthropic' && keys.anthropic?.trim()) return keys.anthropic
    if (provider === 'gemini' && keys.gemini?.trim()) return keys.gemini
    if (provider === 'fireworks' && (keys as any).fireworks?.trim()) return (keys as any).fireworks
    if (provider === 'xai' && (keys as any).xai?.trim()) return (keys as any).xai
  }

  // 2) Fallback: environment variables
  try {
    const envMap: Record<string, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      fireworks: 'FIREWORKS_API_KEY',
      xai: 'XAI_API_KEY',
    }
    const envVar = envMap[provider]
    if (envVar && process?.env?.[envVar]?.trim()) return process.env[envVar]!
  } catch {}

  // 3) Fallback: legacy secure store (migration)
  try {
    const legacy = legacySecureStore.get(provider)
    if (typeof legacy === 'string' && legacy.trim()) return legacy
  } catch {}

  return null
}

/**
 * Provider capability registry
 */
export const providerCapabilities: Record<string, Record<string, boolean>> = {
  openai: { tools: true, jsonSchema: true, vision: false, streaming: true },
  anthropic: { tools: true, jsonSchema: false, vision: false, streaming: true },
  gemini: { tools: true, jsonSchema: false, vision: true, streaming: true },
  fireworks: { tools: true, jsonSchema: true, vision: false, streaming: true },
  xai: { tools: true, jsonSchema: true, vision: false, streaming: true },
}

/**
 * Kanban board filesystem watchers per workspace
 */
const kanbanWatchers = new Map<string, fs.FSWatcher>()
const kanbanDebounces = new Map<string, NodeJS.Timeout>()

function scheduleKanbanReload(workspaceRoot: string): void {
  const existing = kanbanDebounces.get(workspaceRoot)
  if (existing) clearTimeout(existing)
  const t = setTimeout(() => { void triggerKanbanReload(workspaceRoot) }, 200)
  kanbanDebounces.set(workspaceRoot, t)
}

async function triggerKanbanReload(workspaceRoot: string): Promise<void> {
  try {
    const dir = path.join(workspaceRoot, '.hifide-public', 'kanban')
    const { readKanbanBoard } = await import('../store/utils/kanban.js')
    const board = await readKanbanBoard(workspaceRoot)
    const ts = Date.now()
    try { broadcastWorkspaceNotification(workspaceRoot, 'kanban.board.changed', { board, loading: false, saving: false, error: null, lastLoadedAt: ts }) } catch {}
  } catch (error) {
    console.error('[kanban] Failed to refresh board after filesystem update:', error)
  }
}

export async function startKanbanWatcher(workspaceRoot: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hifide-public', 'kanban')
  if (kanbanWatchers.has(workspaceRoot)) return
  try {
    await fsPromises.mkdir(dir, { recursive: true })
    const watcher = fs.watch(dir, (eventType, filename) => {
      if (!filename || filename.toString() !== 'board.json') return
      if (eventType === 'rename' || eventType === 'change') scheduleKanbanReload(workspaceRoot)
    })
    kanbanWatchers.set(workspaceRoot, watcher)
  } catch (error) {
    console.error('[kanban] Failed to start filesystem watcher:', error)
  }
}

export function stopKanbanWatcher(workspaceRoot?: string): void {
  // If a specific workspace is provided, stop only when no active connections remain
  if (workspaceRoot) {
    try {
      // Count connections bound to this workspace; if any, keep watcher running
      let hasConsumer = false
      for (const [, meta] of Array.from(activeConnections.entries())) {
        if (meta.workspaceId === workspaceRoot) { hasConsumer = true; break }
      }
      if (hasConsumer) return
    } catch {}
    const watcher = kanbanWatchers.get(workspaceRoot)
    if (watcher) {
      try { watcher.close() } catch (error) { console.error('[kanban] Failed to stop filesystem watcher:', error) }
    }
    kanbanWatchers.delete(workspaceRoot)
    const t = kanbanDebounces.get(workspaceRoot); if (t) { clearTimeout(t); kanbanDebounces.delete(workspaceRoot) }
    return
  }
  // No workspace specified: stop all (used during app shutdown)
  for (const [root, watcher] of Array.from(kanbanWatchers.entries())) {
    try { watcher.close() } catch {}
    kanbanWatchers.delete(root)
    const t = kanbanDebounces.get(root); if (t) { clearTimeout(t); kanbanDebounces.delete(root) }
  }
}

/**
 * Knowledge Base filesystem watchers per workspace
 */
const kbWatchers = new Map<string, fs.FSWatcher>()
const kbDebounces = new Map<string, NodeJS.Timeout>()

function scheduleKbReload(workspaceRoot: string): void {
  const existing = kbDebounces.get(workspaceRoot); if (existing) clearTimeout(existing)
  const t = setTimeout(() => { void triggerKbReload(workspaceRoot) }, 200)
  kbDebounces.set(workspaceRoot, t)
}

async function triggerKbReload(workspaceRoot: string): Promise<void> {
  try {
    const { listItems } = await import('../store/utils/knowledgeBase.js')
    const items = await listItems(workspaceRoot)
    const map: Record<string, any> = {}
    for (const it of items) map[it.id] = it
    try { broadcastWorkspaceNotification(workspaceRoot, 'kb.items.changed', { items: map, error: null }) } catch {}
  } catch (error) {
    console.error('[kb] Failed to reload index after filesystem update:', error)
  }
}

export async function startKbWatcher(workspaceRoot: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hifide-public', 'kb')
  if (kbWatchers.has(workspaceRoot)) return
  try {
    await fsPromises.mkdir(dir, { recursive: true })
    const watcher = fs.watch(dir, { recursive: process.platform !== 'linux' }, (eventType, filename) => {
      if (!filename || !filename.toString().endsWith('.md')) return
      if (eventType === 'rename' || eventType === 'change') scheduleKbReload(workspaceRoot)
    })
    kbWatchers.set(workspaceRoot, watcher)
  } catch (error) {
    console.error('[kb] Failed to start filesystem watcher:', error)
  }
}

export function stopKbWatcher(workspaceRoot?: string): void {
  if (workspaceRoot) {
    try {
      let hasConsumer = false
      for (const [, meta] of Array.from(activeConnections.entries())) {
        if (meta.workspaceId === workspaceRoot) { hasConsumer = true; break }
      }
      if (hasConsumer) return
    } catch {}
    const watcher = kbWatchers.get(workspaceRoot)
    if (watcher) { try { watcher.close() } catch (error) { console.error('[kb] Failed to stop filesystem watcher:', error) } }
    kbWatchers.delete(workspaceRoot)
    const t = kbDebounces.get(workspaceRoot); if (t) { clearTimeout(t); kbDebounces.delete(workspaceRoot) }
    return
  }
  for (const [root, watcher] of Array.from(kbWatchers.entries())) {
    try { watcher.close() } catch {}
    kbWatchers.delete(root)
    const t = kbDebounces.get(root); if (t) { clearTimeout(t); kbDebounces.delete(root) }
  }
}


/**
 * Provider adapters registry
 */
export const providers: Record<string, ProviderAdapter> = {
  openai: OpenAiSdkProvider,
  anthropic: AnthropicAiSdkProvider,
  gemini: GeminiAiSdkProvider,
  fireworks: FireworksAiSdkProvider,
  xai: XaiAiSdkProvider,
}

/**
 * Indexers per workspace (no global singleton)
 */
const indexers = new Map<string, Indexer>()

/**
 * KB Indexers per workspace
 */
const kbIndexers = new Map<string, Indexer>()

/**
 * Get or create the indexer instance for a workspace.
 * If workspaceRoot is omitted, uses the currently active workspace in the store.
 */
export async function getIndexer(workspaceRoot?: string): Promise<Indexer> {
  const { useMainStore } = await import('../store/index.js')
  const root = path.resolve(
    workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  )
  let idx = indexers.get(root)
  if (!idx) {
    idx = new Indexer(root)
    indexers.set(root, idx)
  }
  return idx
}

/**
 * Get or create the KB indexer instance (indexes .hifide-public/kb) for a workspace.
 */
export async function getKbIndexer(workspaceRoot?: string): Promise<Indexer> {
  const { useMainStore } = await import('../store/index.js')
  const root = path.resolve(
    workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  )
  let idx = kbIndexers.get(root)
  if (!idx) {
    const kbRoot = path.join(root, '.hifide-public', 'kb')
    idx = new Indexer(root, {
      scanRoot: kbRoot,
      indexSubdir: 'kb-index',
      useWorkspaceGitignore: false,
      mode: 'kb',
    })
    kbIndexers.set(root, idx)
  }
  return idx
}

/**
 * Reset the indexer for a workspace (used when workspace root changes)
 */
export async function resetIndexer(workspaceRoot?: string): Promise<void> {
  const { useMainStore } = await import('../store/index.js')
  const root = path.resolve(
    workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  )
  const idx = indexers.get(root)
  if (idx) {
    try { idx.dispose() } catch (error) { console.error('[indexer] Failed to dispose indexer:', error) }
    indexers.delete(root)
  }
}

/**
 * Reset the KB indexer for a workspace
 */
export async function resetKbIndexer(workspaceRoot?: string): Promise<void> {
  const { useMainStore } = await import('../store/index.js')
  const root = path.resolve(
    workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
  )
  const idx = kbIndexers.get(root)
  if (idx) {
    try { idx.dispose() } catch (error) { console.error('[indexer] Failed to dispose KB indexer:', error) }
    kbIndexers.delete(root)
  }
}
