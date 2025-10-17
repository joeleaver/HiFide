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
  // State - Initialized with defaults, persist middleware will restore saved values
  currentView: 'agent',
  
  // Actions
  setCurrentView: (view: ViewType) => {
    set({ currentView: view })

    // Also notify the main process (for menu updates, etc.)
    try { void setAppView(view) } catch (e) { console.error(e) }
  },
})

