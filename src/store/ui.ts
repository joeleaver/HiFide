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
 * This lives outside the main (backend) store because:
 * 1. This state is renderer-only (doesn't need to sync to backend)
 * 2. This state is transient (doesn't need persistence)
 * 3. This state changes frequently during interactions (keeps JSON-RPC chatter minimal)
 */

import { create } from 'zustand'

type ViewType = 'welcome' | 'flow' | 'explorer' | 'sourceControl' | 'knowledgeBase' | 'kanban' | 'settings'

interface UiStore {
  // Panel Resize State
  sessionPanelWidth: number
  metaPanelWidth: number
  isDraggingSessionPanel: boolean
  isDraggingMetaPanel: boolean

  // App-level current view (renderer-only mirror of backend)
  currentView: ViewType

  // Scroll State
  shouldAutoScroll: boolean

  // Input State
  sessionInputValue: string

  // Collapsible Panel States (renderer store; persisted to main debounced)
  metaPanelOpen: boolean
  debugPanelCollapsed: boolean
  debugPanelHeight: number
  debugPanelUserScrolledUp: boolean
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number
  rightPaneCollapsed: boolean
  mainCollapsed: boolean


  // Flow Editor: New Flow Modal (renderer-only)
  newFlowModalOpen: boolean
  newFlowName: string
  newFlowError: string | null

  // Actions
  setSessionPanelWidth: (width: number) => void
  setMetaPanelWidth: (width: number) => void
  setIsDraggingSessionPanel: (dragging: boolean) => void
  setIsDraggingMetaPanel: (dragging: boolean) => void
  setCurrentViewLocal: (view: ViewType) => void
  setShouldAutoScroll: (should: boolean) => void
  setSessionInputValue: (value: string) => void
  setMetaPanelOpen: (open: boolean) => void
  setDebugPanelCollapsed: (collapsed: boolean) => void
  setDebugPanelHeight: (height: number) => void
  setDebugPanelUserScrolledUp: (scrolledUp: boolean) => void
  setContextInspectorCollapsed: (collapsed: boolean) => void
  setContextInspectorHeight: (height: number) => void
  setTokensCostsCollapsed: (collapsed: boolean) => void
  setMainCollapsed: (collapsed: boolean) => void

  setTokensCostsHeight: (height: number) => void
  setRightPaneCollapsed: (collapsed: boolean) => void

  // New Flow Modal actions
  setNewFlowModalOpen: (open: boolean) => void
  setNewFlowName: (name: string) => void
  setNewFlowError: (err: string | null) => void
  resetNewFlowModal: () => void

  // Diff Preview Modal
  diffPreviewOpen: boolean
  diffPreviewData: Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }> | null

  // Diff actions
  openDiffPreview: (data: Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>) => void
  closeDiffPreview: () => void

  // Inline diff per badge (renderer-only)
  inlineDiffByBadge: Record<string, Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>>
  inlineDiffOpenByBadge: Record<string, boolean>
  openInlineDiffForBadge: (badgeId: string, data: Array<{ path: string; before?: string; after?: string; sizeBefore?: number; sizeAfter?: number; truncated?: boolean }>) => void
  closeInlineDiffForBadge: (badgeId: string) => void
  purgeInlineDiffForBadge: (badgeId: string) => void

  // Badge expansion state (renderer-only)
  expandedBadges: Set<string>
  toggleBadgeExpansion: (badgeId: string) => void
  expandBadge: (badgeId: string) => void
  collapseBadge: (badgeId: string) => void
  collapseAllBadges: () => void

}

export const useUiStore = create<UiStore>((set) => ({
  // State - initialized with defaults, will be synced from main store on mount
  sessionPanelWidth: 300,
  mainCollapsed: false,

  metaPanelWidth: 300,
  isDraggingSessionPanel: false,
  isDraggingMetaPanel: false,
  rightPaneCollapsed: false,
  // App-level view defaults to 'welcome' until hydrated from backend or workspace binds
  currentView: 'welcome',
  shouldAutoScroll: true,
  sessionInputValue: '',

  // Collapsible panel states - defaults, will be synced from main store
  metaPanelOpen: false,
  debugPanelCollapsed: false,
  debugPanelHeight: 300,
  debugPanelUserScrolledUp: false,
  contextInspectorCollapsed: false,
  // Diff Preview state
  diffPreviewOpen: false,
  diffPreviewData: null,

  // Inline diff state
  inlineDiffByBadge: {},
  inlineDiffOpenByBadge: {},

  // Badge expansion state
  expandedBadges: new Set<string>(),

  contextInspectorHeight: 200,
  tokensCostsCollapsed: false,
  tokensCostsHeight: 250,


  // New Flow Modal state
  newFlowModalOpen: false,
  newFlowName: '',
  newFlowError: null,

  // Actions
  setSessionPanelWidth: (width) => set({ sessionPanelWidth: width }),
  setMetaPanelWidth: (width) => set({ metaPanelWidth: width }),
  setIsDraggingSessionPanel: (dragging) => set({ isDraggingSessionPanel: dragging }),
  setIsDraggingMetaPanel: (dragging) => set({ isDraggingMetaPanel: dragging }),
  setCurrentViewLocal: (view) => set({ currentView: view }),
  setShouldAutoScroll: (should) => set({ shouldAutoScroll: should }),
  setSessionInputValue: (value) => set({ sessionInputValue: value }),
  setMetaPanelOpen: (open) => set({ metaPanelOpen: open }),
  // Diff actions
  openDiffPreview: (data) => set({ diffPreviewData: data, diffPreviewOpen: true }),
  closeDiffPreview: () => set({ diffPreviewOpen: false, diffPreviewData: null }),
  openInlineDiffForBadge: (badgeId, data) => set((s) => ({
    inlineDiffByBadge: { ...s.inlineDiffByBadge, [badgeId]: data },
    inlineDiffOpenByBadge: { ...s.inlineDiffOpenByBadge, [badgeId]: true }
  })),
  closeInlineDiffForBadge: (badgeId) => set((s) => ({
    inlineDiffOpenByBadge: { ...s.inlineDiffOpenByBadge, [badgeId]: false }
  })),
  purgeInlineDiffForBadge: (badgeId) => set((s) => {
    const dataMap = { ...s.inlineDiffByBadge }
    const openMap = { ...s.inlineDiffOpenByBadge }
    delete dataMap[badgeId]
    delete openMap[badgeId]
    return { inlineDiffByBadge: dataMap, inlineDiffOpenByBadge: openMap }
  }),

  setDebugPanelCollapsed: (collapsed) => set({ debugPanelCollapsed: collapsed }),
  setDebugPanelHeight: (height) => set({ debugPanelHeight: height }),
  setMainCollapsed: (collapsed) => set({ mainCollapsed: collapsed }),

  setDebugPanelUserScrolledUp: (scrolledUp) => set({ debugPanelUserScrolledUp: scrolledUp }),
  setContextInspectorCollapsed: (collapsed) => set({ contextInspectorCollapsed: collapsed }),
  setContextInspectorHeight: (height) => set({ contextInspectorHeight: height }),
  setTokensCostsCollapsed: (collapsed) => set({ tokensCostsCollapsed: collapsed }),
  setTokensCostsHeight: (height) => set({ tokensCostsHeight: height }),
  setRightPaneCollapsed: (collapsed) => set({ rightPaneCollapsed: collapsed }),

  // New Flow Modal actions
  setNewFlowModalOpen: (open) => set({ newFlowModalOpen: open }),
  setNewFlowName: (name) => set({ newFlowName: name }),
  setNewFlowError: (err) => set({ newFlowError: err }),
  resetNewFlowModal: () => set({ newFlowModalOpen: false, newFlowName: '', newFlowError: null }),

  // Badge expansion actions
  toggleBadgeExpansion: (badgeId) => set((s) => {
    const newSet = new Set(s.expandedBadges)
    if (newSet.has(badgeId)) {
      newSet.delete(badgeId)
    } else {
      newSet.add(badgeId)
    }
    return { expandedBadges: newSet }
  }),
  expandBadge: (badgeId) => set((s) => {
    const newSet = new Set(s.expandedBadges)
    newSet.add(badgeId)
    return { expandedBadges: newSet }
  }),
  collapseBadge: (badgeId) => set((s) => {
    const newSet = new Set(s.expandedBadges)
    newSet.delete(badgeId)
    return { expandedBadges: newSet }
  }),
  collapseAllBadges: () => set({ expandedBadges: new Set<string>() }),
}))

