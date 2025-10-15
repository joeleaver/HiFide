/**
 * Persistence utilities for localStorage
 * 
 * Provides type-safe helpers for reading/writing to localStorage
 */

/**
 * Safely get a value from localStorage
 */
export function getFromLocalStorage<T>(key: string, defaultValue: T): T {
  try {
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
 */
export function setInLocalStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`[persistence] Failed to set ${key} in localStorage:`, error)
  }
}

/**
 * Remove a value from localStorage
 */
export function removeFromLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`[persistence] Failed to remove ${key} from localStorage:`, error)
  }
}

/**
 * Check if a key exists in localStorage
 */
export function hasInLocalStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null
  } catch (error) {
    console.error(`[persistence] Failed to check ${key} in localStorage:`, error)
    return false
  }
}

/**
 * Clear all localStorage (use with caution!)
 */
export function clearLocalStorage(): void {
  try {
    localStorage.clear()
  } catch (error) {
    console.error('[persistence] Failed to clear localStorage:', error)
  }
}

