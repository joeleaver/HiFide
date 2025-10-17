/**
 * Persistence utilities for Main Process
 *
 * In the main process, we use electron-store instead of localStorage.
 * These functions provide a compatible API but are no-ops since
 * the persist middleware handles all persistence automatically.
 * 
 * These exist only for API compatibility with code that might call them.
 */

/**
 * No-op in main process - persist middleware handles this
 */
export function getFromLocalStorage<T>(_key: string, defaultValue: T): T {
  return defaultValue
}

/**
 * No-op in main process - persist middleware handles this
 */
export function setInLocalStorage<T>(_key: string, _value: T): void {
  // No-op - persist middleware handles all persistence
}

/**
 * No-op in main process - persist middleware handles this
 */
export function removeFromLocalStorage(_key: string): void {
  // No-op - persist middleware handles all persistence
}

/**
 * No-op in main process - persist middleware handles this
 */
export function hasInLocalStorage(_key: string): boolean {
  return false
}

/**
 * No-op in main process - persist middleware handles this
 */
export function clearLocalStorage(): void {
  // No-op - persist middleware handles all persistence
}

