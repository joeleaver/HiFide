/**
 * Storage adapter for Zustand persist middleware
 * 
 * Uses electron-store for Node.js-compatible persistence in the main process.
 * This replaces localStorage which is only available in the renderer process.
 */

import Store from 'electron-store'
import type { StateStorage } from 'zustand/middleware'

/**
 * Create an electron-store instance for persisting Zustand state
 */
const electronStore = new Store({
  name: 'zustand-state',
  // Store in app data directory
  // On Windows: C:\Users\<user>\AppData\Roaming\hifide\zustand-state.json
  // On macOS: ~/Library/Application Support/hifide/zustand-state.json
  // On Linux: ~/.config/hifide/zustand-state.json
})

// Migration: Remove persisted pricingConfig so it always uses DEFAULT_PRICING
// This ensures new models are available immediately without app restart
const storedState = electronStore.get('hifide-store') as any
if (storedState && typeof storedState === 'object' && 'pricingConfig' in storedState) {
  const { pricingConfig, ...rest } = storedState as any
  electronStore.set('hifide-store', rest)
}

// Migration: Backfill new Fireworks model 'accounts/fireworks/models/minimax-m2' into
// user allowlist if missing (one-time). This keeps existing custom entries intact.
try {
  if (storedState && typeof storedState === 'object') {
    const arr = Array.isArray(storedState.fireworksAllowedModels) ? storedState.fireworksAllowedModels : null
    const toAdd = 'accounts/fireworks/models/minimax-m2'
    if (arr && !arr.includes(toAdd)) {
      const next = [...arr, toAdd]
      electronStore.set('hifide-store', { ...storedState, fireworksAllowedModels: next })
    }
  }
} catch (e) {
  console.warn('[storage:migrate] Failed to backfill Fireworks model minimax-m2', e)
}

/**
 * Storage adapter that implements Zustand's StateStorage interface
 * using electron-store as the backend
 */
export const electronStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const value = electronStore.get(name)
    return value ? JSON.stringify(value) : null
  },
  
  setItem: (name: string, value: string): void => {
    try {
      electronStore.set(name, JSON.parse(value))
    } catch (error) {
      console.error('[storage] Failed to parse value for', name, error)
      electronStore.set(name, value)
    }
  },
  
  removeItem: (name: string): void => {
    electronStore.delete(name)
  },
}

