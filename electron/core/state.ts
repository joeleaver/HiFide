/**
 * Shared application state for the Electron main process
 * 
 * This module provides centralized state management for cross-cutting concerns
 * to prevent circular dependencies and make state access explicit.
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import type { PtySession, FlowHandle, StreamHandle } from '../types'
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

  // Try Zustand store first (primary storage)
  const keys = state.settingsApiKeys
  if (keys) {
    if (provider === 'openai' && keys.openai?.trim()) return keys.openai
    if (provider === 'anthropic' && keys.anthropic?.trim()) return keys.anthropic
    if (provider === 'gemini' && keys.gemini?.trim()) return keys.gemini
  }

  // Fallback to legacy electron-store for migration
  const keyName = provider === 'anthropic' ? 'anthropic' : provider === 'gemini' ? 'gemini' : 'openai'
  const stored = legacySecureStore.get(keyName) as string | undefined
  if (stored) {
    // Migrate to new system
    if (provider === 'openai') state.setOpenAiApiKey(stored)
    if (provider === 'anthropic') state.setAnthropicApiKey(stored)
    if (provider === 'gemini') state.setGeminiApiKey(stored)
    // Remove from legacy storage
    legacySecureStore.delete(keyName)
    return stored
  }

  // Try environment variables
  const env = process.env
  if (provider === 'openai' && env?.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (provider === 'anthropic' && env?.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY
  if (provider === 'gemini' && (env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY)) {
    return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null
  }

  return null
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
export async function getIndexer(): Promise<Indexer> {
  if (!indexer) {
    const { useMainStore } = await import('../store/index.js')
    indexer = new Indexer(useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd())
  }
  return indexer
}

/**
 * Reset the indexer (used when workspace root changes)
 */
export function resetIndexer(): void {
  indexer = null
}

