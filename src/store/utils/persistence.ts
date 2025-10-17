/**
 * Persistence utilities for localStorage
 *
 * Provides type-safe helpers for reading/writing to localStorage
 * Safe to use in both renderer and main process (no-ops in main)
 */

/**
 * Safely get a value from localStorage
 * Returns defaultValue if localStorage is not available (e.g., in main process)
 */
export function getFromLocalStorage<T>(key: string, defaultValue: T): T {
  try {
    // Check if localStorage is available (renderer process only)
    if (typeof localStorage === 'undefined') {
      return defaultValue
    }
    const item = localStorage.getItem(key)
    if (item === null) return defaultValue
    return JSON.parse(item) as T
  } catch (error) {
    console.error(`[persistence] Failed to get ${key} from localStorage:`, error)
    return defaultValue
  }
}

/**
 * Safely set a value in localStorage
 * No-op if localStorage is not available (e.g., in main process)
 */
export function setInLocalStorage<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`[persistence] Failed to set ${key} in localStorage:`, error)
  }
}

/**
 * Remove a value from localStorage
 * No-op if localStorage is not available (e.g., in main process)
 */
export function removeFromLocalStorage(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`[persistence] Failed to remove ${key} from localStorage:`, error)
  }
}

/**
 * Check if a key exists in localStorage
 * Returns false if localStorage is not available (e.g., in main process)
 */
export function hasInLocalStorage(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(key) !== null
  } catch (error) {
    console.error(`[persistence] Failed to check ${key} in localStorage:`, error)
    return false
  }
}

/**
 * Clear all localStorage (use with caution!)
 * No-op if localStorage is not available (e.g., in main process)
 */
export function clearLocalStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.clear()
  } catch (error) {
    console.error('[persistence] Failed to clear localStorage:', error)
  }
}

