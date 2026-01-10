/**
 * Shared application state for the Electron main process
 *
 * This module provides centralized state management for cross-cutting concerns
 * to prevent circular dependencies and make state access explicit.
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import { AnthropicOpenAIProvider as AnthropicAiSdkProvider } from '../providers-ai-sdk/anthropic-openai'
import { GeminiNativeProvider } from '../providers-ai-sdk/gemini-native'
import { FireworksOpenAIProvider } from '../providers-ai-sdk/fireworks-openai'
import { OpenAIOpenAIProvider as OpenAiSdkProvider } from '../providers-ai-sdk/openai-openai'
import { XAIOpenAIProvider as XaiAiSdkProvider } from '../providers-ai-sdk/xai-openai'
import { OpenRouterOpenAIProvider as OpenRouterProvider } from '../providers-ai-sdk/openrouter-openai'
import { activeConnections } from '../backend/ws/broadcast'
import { getSettingsService, getWorkspaceService } from '../services/index.js'

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
  const settingsService = getSettingsService()

  // 1) Try service first (primary storage)
  const keys = settingsService.getApiKeys()
  if (keys) {
    if (provider === 'openai' && keys.openai?.trim()) return keys.openai
    if (provider === 'anthropic' && keys.anthropic?.trim()) return keys.anthropic
    if (provider === 'gemini' && keys.gemini?.trim()) return keys.gemini
    if (provider === 'fireworks' && (keys as any).fireworks?.trim()) return (keys as any).fireworks
    if (provider === 'xai' && (keys as any).xai?.trim()) return (keys as any).xai
    if (provider === 'openrouter' && (keys as any).openrouter?.trim()) return (keys as any).openrouter
  }

  // 2) Fallback: environment variables
  try {
    const envMap: Record<string, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      fireworks: 'FIREWORKS_API_KEY',
      xai: 'XAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
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
  openrouter: { tools: true, jsonSchema: true, vision: false, streaming: true },
}

/**
 * Knowledge Base filesystem watchers per workspace
 */
const kbWatchers = new Map<string, FSWatcher>()
const kbDebounces = new Map<string, NodeJS.Timeout>()

function scheduleKbReload(workspaceRoot: string): void {
  const existing = kbDebounces.get(workspaceRoot); if (existing) clearTimeout(existing)
  const t = setTimeout(() => { void triggerKbReload(workspaceRoot) }, 200)
  kbDebounces.set(workspaceRoot, t)
}

async function triggerKbReload(workspaceRoot: string): Promise<void> {
  try {
    const { getKnowledgeBaseService } = await import('../services/index.js')
    const kbService = getKnowledgeBaseService()
    await kbService.syncFromDisk(workspaceRoot)
  } catch (error) {
    console.error('[kb] Failed to reload index after filesystem update:', error)
  }
}

export async function startKbWatcher(workspaceRoot: string): Promise<void> {
  const dir = path.resolve(workspaceRoot, '.hifide-public', 'kb')
  if (kbWatchers.has(workspaceRoot)) return
  try {
    await fsPromises.mkdir(dir, { recursive: true })
    const watcher = chokidar.watch(dir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 1,
    })
    watcher.on('all', (_event, filename) => {
      if (typeof filename === 'string' && filename.endsWith('.md')) {
        scheduleKbReload(workspaceRoot)
      }
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
      const workspaceService = getWorkspaceService()
      for (const [, meta] of Array.from(activeConnections.entries())) {
        const wsId = workspaceService.getWorkspaceForWindow(meta.windowId)
        if (wsId === workspaceRoot) { hasConsumer = true; break }
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
  gemini: GeminiNativeProvider,
  fireworks: FireworksOpenAIProvider,
  xai: XaiAiSdkProvider,
  openrouter: OpenRouterProvider,
}


