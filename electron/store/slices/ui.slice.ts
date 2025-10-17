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
}

export interface UiSlice {
  // Window state - single source of truth for all UI panel states
  windowState: WindowState

  // Single action to update any part of window state
  updateWindowState: (updates: Partial<WindowState>) => void
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
  agentTerminalPanelOpen: false,
  agentTerminalPanelHeight: 300,
  explorerTerminalPanelOpen: false,
  explorerTerminalPanelHeight: 300,
}

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
  // Window state - single source of truth
  windowState: DEFAULT_WINDOW_STATE,

  // Single action to update window state
  updateWindowState: (updates: Partial<WindowState>) => {
    set((state) => {
      const newWindowState = { ...state.windowState, ...updates }
      return { windowState: newWindowState }
    })
  },
})

