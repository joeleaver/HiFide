/**
 * View Slice
 * 
 * Manages the current application view state.
 * 
 * Responsibilities:
 * - Track current view (agent, explorer, flowEditor, etc.)
 * - Persist view selection to localStorage
 * - Provide view switching functionality
 */

import type { StateCreator } from 'zustand'
import type { ViewType } from '../types'
import { LS_KEYS, DEFAULTS } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage } from '../utils/persistence'
import { setAppView } from '../../services/appBridge'

// ============================================================================
// Types
// ============================================================================

export interface ViewSlice {
  // State
  currentView: ViewType
  
  // Actions
  setCurrentView: (view: ViewType) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createViewSlice: StateCreator<ViewSlice> = (set) => ({
  // Initialize from localStorage or use default
  currentView: getFromLocalStorage<ViewType>(LS_KEYS.CURRENT_VIEW, DEFAULTS.CURRENT_VIEW),
  
  // Actions
  setCurrentView: (view: ViewType) => {
    set({ currentView: view })
    setInLocalStorage(LS_KEYS.CURRENT_VIEW, view)
    
    // Also notify the main process (for menu updates, etc.)
    try { void setAppView(view) } catch (e) { console.error(e) }
  },
})

