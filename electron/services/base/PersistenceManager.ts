/**
 * Persistence Manager
 * 
 * Handles persistence to electron-store.
 * Uses the same storage backend as Zustand persist middleware.
 */

import Store from 'electron-store'

export class PersistenceManager {
  private store: Store

  constructor() {
    // Use the same store name as Zustand for compatibility during migration
    this.store = new Store({
      name: 'hifide-store',
      // Store in app data directory
      // On Windows: C:\Users\<user>\AppData\Roaming\hifide\hifide-store.json
      // On macOS: ~/Library/Application Support/hifide/hifide-store.json
      // On Linux: ~/.config/hifide/hifide-store.json
    })
  }

  /**
   * Save data to storage
   */
  save<T>(key: string, data: T): void {
    try {
      this.store.set(key, data)
    } catch (error) {
      console.error(`[PersistenceManager] Failed to save ${key}:`, error)
      throw error
    }
  }

  /**
   * Load data from storage
   */
  load<T>(key: string, defaultValue: T): T {
    try {
      const value = this.store.get(key, defaultValue)
      return value as T
    } catch (error) {
      console.error(`[PersistenceManager] Failed to load ${key}:`, error)
      return defaultValue
    }
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.store.has(key)
  }

  /**
   * Delete a key
   */
  delete(key: string): void {
    this.store.delete(key)
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    // electron-store doesn't have a keys() method, so we need to get the store object
    const storeData = this.store.store
    return Object.keys(storeData)
  }

  /**
   * Get the underlying electron-store instance
   */
  getStore(): Store {
    return this.store
  }
}

