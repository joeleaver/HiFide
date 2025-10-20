/**
 * Renderer-Only UI Store
 * 
 * Manages transient UI state that doesn't need to be persisted or synced to main process.
 * This includes:
 * - Panel resize state (local width during drag)
 * - Scroll positions and auto-scroll behavior
 * - Drag states
 * - Other ephemeral UI state
 * 
 * This is separate from the main zubridge store because:
 * 1. This state is renderer-only (doesn't need to sync to main)
 * 2. This state is transient (doesn't need persistence)
 * 3. This state changes frequently during interactions (would spam IPC if in main store)
 */

import { create } from 'zustand'

interface UiStore {
  // Panel Resize State
  sessionPanelWidth: number
  metaPanelWidth: number
  isDraggingSessionPanel: boolean
  isDraggingMetaPanel: boolean

  // Scroll State
  shouldAutoScroll: boolean

  // Input State
  sessionInputValue: string

  // Collapsible Panel States (synced with main store)
  debugPanelCollapsed: boolean
  debugPanelHeight: number
  debugPanelUserScrolledUp: boolean
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number

  // Actions
  setSessionPanelWidth: (width: number) => void
  setMetaPanelWidth: (width: number) => void
  setIsDraggingSessionPanel: (dragging: boolean) => void
  setIsDraggingMetaPanel: (dragging: boolean) => void
  setShouldAutoScroll: (should: boolean) => void
  setSessionInputValue: (value: string) => void
  setDebugPanelCollapsed: (collapsed: boolean) => void
  setDebugPanelHeight: (height: number) => void
  setDebugPanelUserScrolledUp: (scrolledUp: boolean) => void
  setContextInspectorCollapsed: (collapsed: boolean) => void
  setContextInspectorHeight: (height: number) => void
  setTokensCostsCollapsed: (collapsed: boolean) => void
  setTokensCostsHeight: (height: number) => void
}

export const useUiStore = create<UiStore>((set) => ({
  // State - initialized with defaults, will be synced from main store on mount
  sessionPanelWidth: 300,
  metaPanelWidth: 300,
  isDraggingSessionPanel: false,
  isDraggingMetaPanel: false,
  shouldAutoScroll: true,
  sessionInputValue: '',

  // Collapsible panel states - defaults, will be synced from main store
  debugPanelCollapsed: false,
  debugPanelHeight: 300,
  debugPanelUserScrolledUp: false,
  contextInspectorCollapsed: false,
  contextInspectorHeight: 200,
  tokensCostsCollapsed: false,
  tokensCostsHeight: 250,

  // Actions
  setSessionPanelWidth: (width) => set({ sessionPanelWidth: width }),
  setMetaPanelWidth: (width) => set({ metaPanelWidth: width }),
  setIsDraggingSessionPanel: (dragging) => set({ isDraggingSessionPanel: dragging }),
  setIsDraggingMetaPanel: (dragging) => set({ isDraggingMetaPanel: dragging }),
  setShouldAutoScroll: (should) => set({ shouldAutoScroll: should }),
  setSessionInputValue: (value) => set({ sessionInputValue: value }),
  setDebugPanelCollapsed: (collapsed) => set({ debugPanelCollapsed: collapsed }),
  setDebugPanelHeight: (height) => set({ debugPanelHeight: height }),
  setDebugPanelUserScrolledUp: (scrolledUp) => set({ debugPanelUserScrolledUp: scrolledUp }),
  setContextInspectorCollapsed: (collapsed) => set({ contextInspectorCollapsed: collapsed }),
  setContextInspectorHeight: (height) => set({ contextInspectorHeight: height }),
  setTokensCostsCollapsed: (collapsed) => set({ tokensCostsCollapsed: collapsed }),
  setTokensCostsHeight: (height) => set({ tokensCostsHeight: height }),
}))

