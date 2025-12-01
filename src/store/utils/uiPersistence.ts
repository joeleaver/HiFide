/**
 * Workspace-scoped localStorage persistence for UI state
 * 
 * Each workspace gets its own localStorage key to ensure UI state
 * doesn't bleed across different workspaces in multi-window scenarios.
 */

import { useBackendBinding } from '../binding'

const UI_STORAGE_PREFIX = 'hifide:ui-state:'
const GLOBAL_KEY = 'hifide:ui-state:global'

export interface PersistedUiState {
  // Panel widths
  sessionPanelWidth: number
  metaPanelWidth: number
  
  // Panel states
  metaPanelOpen: boolean
  debugPanelCollapsed: boolean
  debugPanelHeight: number
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number
  rightPaneCollapsed: boolean
  
  // Current view (routing)
  currentView: string
}

/**
 * Get the localStorage key for the current workspace
 * Falls back to global key if no workspace is attached
 */
function getStorageKey(): string {
  const workspaceId = useBackendBinding.getState().workspaceId
  if (!workspaceId) return GLOBAL_KEY
  
  // Hash workspace path to make it safe for localStorage key
  // Use btoa (base64) and strip non-alphanumeric chars
  try {
    const hash = btoa(workspaceId).replace(/[^a-zA-Z0-9]/g, '')
    return `${UI_STORAGE_PREFIX}${hash}`
  } catch {
    // If btoa fails (e.g., non-ASCII chars), use a simple hash
    let hash = 0
    for (let i = 0; i < workspaceId.length; i++) {
      const char = workspaceId.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return `${UI_STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

/**
 * Load UI state from localStorage for the current workspace
 */
export function loadUiState(): Partial<PersistedUiState> {
  try {
    const key = getStorageKey()
    const stored = localStorage.getItem(key)
    if (!stored) return {}
    
    const parsed = JSON.parse(stored)
    return parsed || {}
  } catch (e) {
    console.warn('[uiPersistence] Failed to load UI state:', e)
    return {}
  }
}

/**
 * Save UI state to localStorage for the current workspace
 * Merges with existing state to avoid overwriting other fields
 */
export function saveUiState(state: Partial<PersistedUiState>): void {
  try {
    const key = getStorageKey()
    const existing = loadUiState()
    const merged = { ...existing, ...state }
    localStorage.setItem(key, JSON.stringify(merged))
  } catch (e) {
    console.warn('[uiPersistence] Failed to save UI state:', e)
  }
}

/**
 * Debounced save for high-frequency updates (e.g., panel resize)
 * Avoids excessive localStorage writes during drag operations
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null

export function saveUiStateDebounced(state: Partial<PersistedUiState>, delayMs = 500): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  saveTimeout = setTimeout(() => {
    saveUiState(state)
    saveTimeout = null
  }, delayMs)
}

/**
 * Clear UI state for the current workspace
 * Useful for testing or resetting to defaults
 */
export function clearUiState(): void {
  try {
    const key = getStorageKey()
    localStorage.removeItem(key)
  } catch (e) {
    console.warn('[uiPersistence] Failed to clear UI state:', e)
  }
}

/**
 * Reload UI state when workspace changes
 * Should be called when workspace.attached event fires
 */
export function reloadUiStateForWorkspace(): Partial<PersistedUiState> {
  return loadUiState()
}

