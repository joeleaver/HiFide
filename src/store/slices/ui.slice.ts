/**
 * UI Slice
 * 
 * Manages UI panel states (sidebar, meta panel, terminal panels, etc.)
 * 
 * Responsibilities:
 * - Track panel open/closed states
 * - Track panel sizes (heights)
 * - Persist UI preferences to localStorage
 */

import type { StateCreator } from 'zustand'
import { LS_KEYS, DEFAULTS } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage } from '../utils/persistence'

// ============================================================================
// Types
// ============================================================================

export interface UiSlice {
  // Agent Mode (Chat vs Flow)
  agentMode: 'chat' | 'flow'
  setAgentMode: (mode: 'chat' | 'flow') => void

  // Flow Canvas Panel
  flowCanvasCollapsed: boolean
  setFlowCanvasCollapsed: (collapsed: boolean) => void
  flowCanvasWidth: number
  setFlowCanvasWidth: (width: number) => void

  // Meta Panel
  metaPanelOpen: boolean
  setMetaPanelOpen: (open: boolean) => void

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void

  // Debug Panel
  debugPanelCollapsed: boolean
  setDebugPanelCollapsed: (collapsed: boolean) => void
  debugPanelHeight: number
  setDebugPanelHeight: (height: number) => void

  // Agent Terminal Panel
  agentTerminalPanelOpen: boolean
  setAgentTerminalPanelOpen: (open: boolean) => void
  agentTerminalPanelHeight: number
  setAgentTerminalPanelHeight: (height: number) => void

  // Explorer Terminal Panel
  explorerTerminalPanelOpen: boolean
  setExplorerTerminalPanelOpen: (open: boolean) => void
  toggleExplorerTerminalPanel: () => void
  explorerTerminalPanelHeight: number
  setExplorerTerminalPanelHeight: (height: number) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createUiSlice: StateCreator<UiSlice> = (set, get) => ({
  // Initialize from localStorage or use defaults
  agentMode: getFromLocalStorage<'chat' | 'flow'>(LS_KEYS.AGENT_MODE, DEFAULTS.AGENT_MODE),
  flowCanvasCollapsed: getFromLocalStorage<boolean>(LS_KEYS.FLOW_CANVAS_COLLAPSED, DEFAULTS.FLOW_CANVAS_COLLAPSED),
  flowCanvasWidth: getFromLocalStorage<number>(LS_KEYS.FLOW_CANVAS_WIDTH, DEFAULTS.FLOW_CANVAS_WIDTH),
  metaPanelOpen: getFromLocalStorage<boolean>(LS_KEYS.META_PANEL_OPEN, DEFAULTS.META_PANEL_OPEN),
  sidebarCollapsed: getFromLocalStorage<boolean>(LS_KEYS.SIDEBAR_COLLAPSED, DEFAULTS.SIDEBAR_COLLAPSED),
  debugPanelCollapsed: getFromLocalStorage<boolean>(LS_KEYS.DEBUG_PANEL_COLLAPSED, DEFAULTS.DEBUG_PANEL_COLLAPSED),
  debugPanelHeight: getFromLocalStorage<number>(LS_KEYS.DEBUG_PANEL_HEIGHT, DEFAULTS.DEBUG_PANEL_HEIGHT),
  agentTerminalPanelOpen: getFromLocalStorage<boolean>(LS_KEYS.AGENT_TERMINAL_PANEL_OPEN, DEFAULTS.AGENT_TERMINAL_PANEL_OPEN),
  agentTerminalPanelHeight: getFromLocalStorage<number>(LS_KEYS.AGENT_TERMINAL_PANEL_HEIGHT, DEFAULTS.AGENT_TERMINAL_PANEL_HEIGHT),
  explorerTerminalPanelOpen: getFromLocalStorage<boolean>(LS_KEYS.EXPLORER_TERMINAL_PANEL_OPEN, DEFAULTS.EXPLORER_TERMINAL_PANEL_OPEN),
  explorerTerminalPanelHeight: getFromLocalStorage<number>(LS_KEYS.EXPLORER_TERMINAL_PANEL_HEIGHT, DEFAULTS.EXPLORER_TERMINAL_PANEL_HEIGHT),

  // Agent Mode Actions
  setAgentMode: (mode: 'chat' | 'flow') => {
    set({ agentMode: mode })
    setInLocalStorage(LS_KEYS.AGENT_MODE, mode)
  },

  // Flow Canvas Actions
  setFlowCanvasCollapsed: (collapsed: boolean) => {
    set({ flowCanvasCollapsed: collapsed })
    setInLocalStorage(LS_KEYS.FLOW_CANVAS_COLLAPSED, collapsed)
  },

  setFlowCanvasWidth: (width: number) => {
    set({ flowCanvasWidth: width })
    setInLocalStorage(LS_KEYS.FLOW_CANVAS_WIDTH, width)
  },

  // Meta Panel Actions
  setMetaPanelOpen: (open: boolean) => {
    set({ metaPanelOpen: open })
    setInLocalStorage(LS_KEYS.META_PANEL_OPEN, open)
  },
  
  // Sidebar Actions
  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
    setInLocalStorage(LS_KEYS.SIDEBAR_COLLAPSED, collapsed)
  },
  
  // Debug Panel Actions
  setDebugPanelCollapsed: (collapsed: boolean) => {
    set({ debugPanelCollapsed: collapsed })
    setInLocalStorage(LS_KEYS.DEBUG_PANEL_COLLAPSED, collapsed)
  },

  setDebugPanelHeight: (height: number) => {
    set({ debugPanelHeight: height })
    setInLocalStorage(LS_KEYS.DEBUG_PANEL_HEIGHT, height)
  },
  
  // Agent Terminal Panel Actions
  setAgentTerminalPanelOpen: (open: boolean) => {
    set({ agentTerminalPanelOpen: open })
    setInLocalStorage(LS_KEYS.AGENT_TERMINAL_PANEL_OPEN, open)
  },
  
  setAgentTerminalPanelHeight: (height: number) => {
    set({ agentTerminalPanelHeight: height })
    setInLocalStorage(LS_KEYS.AGENT_TERMINAL_PANEL_HEIGHT, height)
  },
  
  // Explorer Terminal Panel Actions
  setExplorerTerminalPanelOpen: (open: boolean) => {
    set({ explorerTerminalPanelOpen: open })
    setInLocalStorage(LS_KEYS.EXPLORER_TERMINAL_PANEL_OPEN, open)
  },
  
  toggleExplorerTerminalPanel: () => {
    const newState = !get().explorerTerminalPanelOpen
    set({ explorerTerminalPanelOpen: newState })
    setInLocalStorage(LS_KEYS.EXPLORER_TERMINAL_PANEL_OPEN, newState)
  },
  
  setExplorerTerminalPanelHeight: (height: number) => {
    set({ explorerTerminalPanelHeight: height })
    setInLocalStorage(LS_KEYS.EXPLORER_TERMINAL_PANEL_HEIGHT, height)
  },
})

