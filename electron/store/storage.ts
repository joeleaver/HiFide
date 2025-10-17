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
const storedState = electronStore.get('hifide-store')
if (storedState && typeof storedState === 'object' && 'pricingConfig' in storedState) {
  const { pricingConfig, ...rest } = storedState as any
  electronStore.set('hifide-store', rest)
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

