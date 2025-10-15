/**
 * Shared application state for the Electron main process
 * 
 * This module provides centralized state management for cross-cutting concerns
 * to prevent circular dependencies and make state access explicit.
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import type { PtySession, FlowHandle, StreamHandle, ProviderKeyName } from '../types'
import { Indexer } from '../indexing/indexer'
import { OpenAIProvider } from '../providers/openai'
import { AnthropicProvider } from '../providers/anthropic'
import { GeminiProvider } from '../providers/gemini'
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
 * Secure persistent store for API keys (electron-store handles multi-instance safely)
 */
export const secureStore = new Store({
  name: 'hifide-secrets',
  encryptionKey: 'hifide-local-encryption-key', // Basic obfuscation
})

/**
 * Window state store for persisting window size and position
 */
export const windowStateStore = new Store({
  name: 'hifide-window-state',
})

/**
 * In-memory cache for provider API keys (loaded from electron-store on startup)
 */
const providerKeysMem: Record<string, string> = {}

/**
 * Normalize provider name to key name
 */
export function providerKeyName(provider: string): ProviderKeyName {
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'gemini') return 'gemini'
  return 'openai'
}

/**
 * Load keys from electron-store into memory cache
 */
export function loadKeysFromStore(): void {
  try {
    const openai = secureStore.get('openai') as string | undefined
    const anthropic = secureStore.get('anthropic') as string | undefined
    const gemini = secureStore.get('gemini') as string | undefined
    
    if (openai) providerKeysMem.openai = openai
    if (anthropic) providerKeysMem.anthropic = anthropic
    if (gemini) providerKeysMem.gemini = gemini
    
    console.log('[state] Loaded keys from electron-store:', {
      openai: openai ? openai.slice(0, 10) + '...' : 'none',
      anthropic: anthropic ? anthropic.slice(0, 10) + '...' : 'none',
      gemini: gemini ? gemini.slice(0, 10) + '...' : 'none',
    })
  } catch (e) {
    console.error('[state] Failed to load keys from electron-store:', e)
  }
}

/**
 * Get provider API key from memory cache or environment
 */
export async function getProviderKey(provider: string): Promise<string | null> {
  const keyName = providerKeyName(provider)
  
  // Try memory cache first
  if (providerKeysMem[keyName]) {
    return providerKeysMem[keyName]
  }
  
  // Try electron-store
  const stored = secureStore.get(keyName) as string | undefined
  if (stored) {
    providerKeysMem[keyName] = stored
    return stored
  }
  
  // Try environment variables
  const env = process.env
  if (keyName === 'openai' && env?.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (keyName === 'anthropic' && env?.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY
  if (keyName === 'gemini' && (env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY)) {
    return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null
  }
  
  return null
}

/**
 * Set provider API key in memory and persistent store
 */
export function setProviderKey(provider: string, key: string): void {
  const keyName = providerKeyName(provider)
  providerKeysMem[keyName] = key
  secureStore.set(keyName, key)
  console.log(`[state] Saved ${keyName} to electron-store`)
}

/**
 * Get provider key from memory cache only
 */
export function getProviderKeyFromMemory(provider: string): string | null {
  const keyName = providerKeyName(provider)
  return providerKeysMem[keyName] || null
}

/**
 * Compute provider presence (which providers have keys available)
 */
export function computeProviderPresence(): { openai: boolean; anthropic: boolean; gemini: boolean } {
  const env = process.env
  const hasOpenAI = !!providerKeysMem.openai || !!env?.OPENAI_API_KEY
  const hasAnthropic = !!providerKeysMem.anthropic || !!env?.ANTHROPIC_API_KEY
  const hasGemini = !!providerKeysMem.gemini || !!env?.GEMINI_API_KEY || !!env?.GOOGLE_API_KEY
  return { openai: hasOpenAI, anthropic: hasAnthropic, gemini: hasGemini }
}

/**
 * Broadcast provider presence to all windows
 */
export function broadcastProviderPresence(): void {
  const payload = computeProviderPresence()
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send('secrets:presence-changed', payload)
      } catch {}
    }
  } catch {}
}

/**
 * PTY sessions map (sessionId -> session info)
 */
export const ptySessions = new Map<string, PtySession>()

/**
 * Inflight LLM request handles (requestId -> stream handle)
 */
export const inflightRequests = new Map<string, StreamHandle>()

/**
 * Inflight flow execution handles (requestId -> flow handle)
 */
export const inflightFlows = new Map<string, FlowHandle>()

/**
 * Provider capability registry
 */
export const providerCapabilities: Record<string, Record<string, boolean>> = {
  openai: { tools: true, jsonSchema: true, vision: false, streaming: true },
  anthropic: { tools: true, jsonSchema: false, vision: false, streaming: true },
  gemini: { tools: true, jsonSchema: true, vision: true, streaming: true },
}

/**
 * Provider adapters registry
 */
export const providers: Record<string, ProviderAdapter> = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
}

/**
 * Indexer singleton
 */
let indexer: Indexer | null = null

/**
 * Get or create the indexer instance
 */
export function getIndexer(): Indexer {
  if (!indexer) {
    indexer = new Indexer(process.env.APP_ROOT || process.cwd())
  }
  return indexer
}

/**
 * Reset the indexer (used when workspace root changes)
 */
export function resetIndexer(): void {
  indexer = null
}

/**
 * Initialize state on app startup
 */
export function initializeState(): void {
  loadKeysFromStore()
}

