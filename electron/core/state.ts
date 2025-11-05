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
 * Kanban board filesystem watcher state
 */
let kanbanWatcher: fs.FSWatcher | null = null
let kanbanWatchedDir: string | null = null
let kanbanWatcherDebounce: NodeJS.Timeout | null = null

function scheduleKanbanReload(): void {
  if (kanbanWatcherDebounce) {
    clearTimeout(kanbanWatcherDebounce)
  }
  kanbanWatcherDebounce = setTimeout(() => {
    void triggerKanbanReload()
  }, 200)
}

async function triggerKanbanReload(): Promise<void> {
  try {
    const { useMainStore } = await import('../store/index.js')
    const state = useMainStore.getState() as any
    if (typeof state.kanbanRefreshFromDisk === 'function') {
      await state.kanbanRefreshFromDisk()
    }
  } catch (error) {
    console.error('[kanban] Failed to refresh board after filesystem update:', error)
  }
}

export async function startKanbanWatcher(workspaceRoot: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hifide-public', 'kanban')
  if (kanbanWatchedDir === dir && kanbanWatcher) return

  stopKanbanWatcher()

  try {
    await fsPromises.mkdir(dir, { recursive: true })
    kanbanWatcher = fs.watch(dir, (eventType, filename) => {
      if (!filename || filename.toString() !== 'board.json') return
      if (eventType === 'rename' || eventType === 'change') {
        scheduleKanbanReload()
      }
    })
    kanbanWatchedDir = dir
  } catch (error) {
    console.error('[kanban] Failed to start filesystem watcher:', error)
  }
}

export function stopKanbanWatcher(): void {
  if (kanbanWatcher) {
    try {
      kanbanWatcher.close()
    } catch (error) {
      console.error('[kanban] Failed to stop filesystem watcher:', error)
    }
  }
  kanbanWatcher = null
  kanbanWatchedDir = null
  if (kanbanWatcherDebounce) {
    clearTimeout(kanbanWatcherDebounce)
    kanbanWatcherDebounce = null
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
 * Indexer singleton
 */
let indexer: Indexer | null = null

/**
 * KB Indexer singleton
 */
let kbIndexer: Indexer | null = null

/**
 * Get or create the indexer instance
 */
export async function getIndexer(): Promise<Indexer> {
  if (!indexer) {
    const { useMainStore } = await import('../store/index.js')
    indexer = new Indexer(
      useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd(),
    )
  }
  return indexer
}

/**
 * Get or create the KB indexer instance (indexes .hifide-public/kb)
 */
export async function getKbIndexer(): Promise<Indexer> {
  if (!kbIndexer) {
    const { useMainStore } = await import('../store/index.js')
    const workspaceRoot =
      useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    const kbRoot = path.join(workspaceRoot, '.hifide-public', 'kb')
    // KB indexing scans the KB folder but treats workspace root as canonical root for paths
    kbIndexer = new Indexer(workspaceRoot, {
      scanRoot: kbRoot,
      indexSubdir: 'kb-index',
      useWorkspaceGitignore: false,
      mode: 'kb',
    })
  }
  return kbIndexer
}

/**
 * Reset the indexer (used when workspace root changes)
 */
export function resetIndexer(): void {
  if (indexer) {
    try {
      indexer.dispose()
    } catch (error) {
      console.error('[indexer] Failed to dispose existing indexer:', error)
    }
  }
  indexer = null
}

/**
 * Reset the KB indexer (used when workspace root changes)
 */
export function resetKbIndexer(): void {
  if (kbIndexer) {
    try {
      kbIndexer.dispose()
    } catch (error) {
      console.error('[indexer] Failed to dispose existing KB indexer:', error)
    }
  }
  kbIndexer = null
}
