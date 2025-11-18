/**
 * UI Slice
 *
 * Manages UI panel states (sidebar, meta panel, terminal panels, etc.)
 *
 * Responsibilities:
 * - Track panel open/closed states
 * - Track panel sizes (heights/widths)
 * - Persist UI preferences via windowState object
 */

import type { StateCreator } from 'zustand'
import { electronStorage } from '../storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Window state - all UI panel sizes and states in one object
 * This is persisted as a single unit to avoid duplication
 */
export interface WindowState {
  // Agent Mode
  agentMode: 'chat' | 'flow'

  // Flow Canvas Panel
  flowCanvasCollapsed: boolean
  flowCanvasWidth: number

  // Meta Panel (Tools Panel)
  metaPanelOpen: boolean
  metaPanelWidth: number

  // Sidebar
  sidebarCollapsed: boolean

  // Debug Panel (Flow Debug)
  debugPanelCollapsed: boolean
  debugPanelHeight: number

  // Context Inspector Panel
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number

  // Tokens & Costs Panel
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number

  // Session Panel (in Agent view)
  sessionPanelWidth: number
  sessionPanelHeight: number

  // Agent Terminal Panel
  agentTerminalPanelOpen: boolean
  agentTerminalPanelHeight: number

  // Explorer Terminal Panel
  explorerTerminalPanelOpen: boolean
  explorerTerminalPanelHeight: number
  rightPaneCollapsed: boolean
}

export interface UiSlice {
  // Window state - single source of truth for all UI panel states
  windowState: WindowState

  // Single action to update any part of window state
  updateWindowState: (updates: Partial<WindowState>) => void

  // Persist-only (no broadcast): writes to electron-store without set()
  persistWindowState: (params: { updates: Partial<WindowState> }) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

const DEFAULT_WINDOW_STATE: WindowState = {
  agentMode: 'chat',
  flowCanvasCollapsed: false,
  flowCanvasWidth: 600,
  metaPanelOpen: false,
  metaPanelWidth: 300,
  sidebarCollapsed: false,
  debugPanelCollapsed: false,
  debugPanelHeight: 300,
  contextInspectorCollapsed: false,
  contextInspectorHeight: 200,
  tokensCostsCollapsed: false,
  tokensCostsHeight: 250,
  sessionPanelWidth: 400,
  sessionPanelHeight: 400,
  rightPaneCollapsed: false,
  agentTerminalPanelOpen: false,
  agentTerminalPanelHeight: 300,
  explorerTerminalPanelOpen: false,
  explorerTerminalPanelHeight: 300,
}

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
  // Window state - single source of truth
  windowState: DEFAULT_WINDOW_STATE,

  // Single action to update window state (will broadcast)
  // Skips set() if updates do not change any keys to avoid churn
  updateWindowState: (updates: Partial<WindowState>) => {
    set((state) => {
      // Shallow compare only the provided keys
      const keys = Object.keys(updates) as (keyof WindowState)[]
      let changed = false
      for (const k of keys) {
        if (state.windowState[k] !== updates[k]) { changed = true; break }
      }
      if (!changed) return {}
      return { windowState: { ...state.windowState, ...updates } }
    })
  },

  // Persist-only update (renderer observes via explicit JSON-RPC notifications)
  persistWindowState: ({ updates }) => {
    try {
      const key = 'hifide-store'
      const raw = electronStorage.getItem(key) as string | null
      const current = raw ? JSON.parse(raw as string) : {}
      const prevWS = (current && typeof current === 'object' && current.windowState) || DEFAULT_WINDOW_STATE
      const nextWS = { ...prevWS, ...updates }
      const next = { ...current, windowState: nextWS }
      electronStorage.setItem(key, JSON.stringify(next))
    } catch (err) {
      console.error('[ui.slice] persistWindowState failed', err)
    }
  },
})

