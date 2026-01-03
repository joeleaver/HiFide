/**
 * Renderer-Only UI Store
 *
 * Manages UI state with workspace-scoped localStorage persistence.
 * This includes:
 * - Panel widths and heights (persisted per workspace)
 * - Panel collapsed states (persisted per workspace)
 * - Current view/routing (persisted per workspace)
 * - Transient state (drag states, scroll positions, modal states - not persisted)
 *
 * UI state is persisted to localStorage with workspace-scoped keys to ensure
 * each workspace has independent UI preferences in multi-window scenarios.
 */

import { create } from 'zustand'
import type { ViewType } from '../../electron/store/types'
import { loadUiState, saveUiState, saveUiStateDebounced } from './utils/uiPersistence'
import { MIN_SESSION_PANEL_WIDTH } from '../constants/layout'

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
  /** Optional structured context to attach to the next user submission (transient; not persisted) */
  sessionInputContext: unknown | null

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
  setSessionInputContext: (ctx: unknown | null) => void
  clearSessionInputContext: () => void
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

// Load persisted UI state from localStorage (workspace-scoped)
const persisted = loadUiState()

const clampSessionPanelWidth = (width?: number | null) => {
  const numeric = typeof width === 'number' && Number.isFinite(width) ? width : MIN_SESSION_PANEL_WIDTH
  return Math.max(MIN_SESSION_PANEL_WIDTH, numeric)
}

export const useUiStore = create<UiStore>((set) => ({
  // Persisted state - initialized from localStorage with fallback to defaults
  sessionPanelWidth: clampSessionPanelWidth(persisted.sessionPanelWidth),
  metaPanelWidth: persisted.metaPanelWidth ?? 300,
  metaPanelOpen: persisted.metaPanelOpen ?? false,
  debugPanelCollapsed: persisted.debugPanelCollapsed ?? false,
  debugPanelHeight: persisted.debugPanelHeight ?? 300,
  contextInspectorCollapsed: persisted.contextInspectorCollapsed ?? false,
  contextInspectorHeight: persisted.contextInspectorHeight ?? 200,
  tokensCostsCollapsed: persisted.tokensCostsCollapsed ?? false,
  tokensCostsHeight: persisted.tokensCostsHeight ?? 250,
  rightPaneCollapsed: persisted.rightPaneCollapsed ?? false,
  currentView: (persisted.currentView as ViewType) ?? 'welcome',

  // Transient state - not persisted, always starts with defaults
  mainCollapsed: false,
  isDraggingSessionPanel: false,
  isDraggingMetaPanel: false,
  shouldAutoScroll: true,
  sessionInputValue: '',
  sessionInputContext: null,
  debugPanelUserScrolledUp: false,

  // Diff Preview state (transient)
  diffPreviewOpen: false,
  diffPreviewData: null,

  // Inline diff state (transient)
  inlineDiffByBadge: {},
  inlineDiffOpenByBadge: {},

  // Badge expansion state (transient)
  expandedBadges: new Set<string>(),

  // New Flow Modal state (transient)
  newFlowModalOpen: false,
  newFlowName: '',
  newFlowError: null,

  // Actions with localStorage persistence
  setSessionPanelWidth: (width) => {
    const nextWidth = clampSessionPanelWidth(width)
    set({ sessionPanelWidth: nextWidth })
    saveUiStateDebounced({ sessionPanelWidth: nextWidth })
  },
  setMetaPanelWidth: (width) => {
    set({ metaPanelWidth: width })
    saveUiStateDebounced({ metaPanelWidth: width })
  },
  setMetaPanelOpen: (open) => {
    set({ metaPanelOpen: open })
    saveUiState({ metaPanelOpen: open })
  },
  setDebugPanelCollapsed: (collapsed) => {
    set({ debugPanelCollapsed: collapsed })
    saveUiState({ debugPanelCollapsed: collapsed })
  },
  setDebugPanelHeight: (height) => {
    set({ debugPanelHeight: height })
    saveUiStateDebounced({ debugPanelHeight: height })
  },
  setContextInspectorCollapsed: (collapsed) => {
    set({ contextInspectorCollapsed: collapsed })
    saveUiState({ contextInspectorCollapsed: collapsed })
  },
  setContextInspectorHeight: (height) => {
    set({ contextInspectorHeight: height })
    saveUiStateDebounced({ contextInspectorHeight: height })
  },
  setTokensCostsCollapsed: (collapsed) => {
    set({ tokensCostsCollapsed: collapsed })
    saveUiState({ tokensCostsCollapsed: collapsed })
  },
  setTokensCostsHeight: (height) => {
    set({ tokensCostsHeight: height })
    saveUiStateDebounced({ tokensCostsHeight: height })
  },
  setRightPaneCollapsed: (collapsed) => {
    set({ rightPaneCollapsed: collapsed })
    saveUiState({ rightPaneCollapsed: collapsed })
  },
  setCurrentViewLocal: (view) => {
    set({ currentView: view })
    saveUiState({ currentView: view })
  },

  // Transient actions (no persistence)
  setIsDraggingSessionPanel: (dragging) => set({ isDraggingSessionPanel: dragging }),
  setIsDraggingMetaPanel: (dragging) => set({ isDraggingMetaPanel: dragging }),
  setShouldAutoScroll: (should) => set({ shouldAutoScroll: should }),
  setSessionInputValue: (value) => set({ sessionInputValue: value }),
  setSessionInputContext: (ctx) => set({ sessionInputContext: ctx }),
  clearSessionInputContext: () => set({ sessionInputContext: null }),
  setDebugPanelUserScrolledUp: (scrolledUp) => set({ debugPanelUserScrolledUp: scrolledUp }),
  setMainCollapsed: (collapsed) => set({ mainCollapsed: collapsed }),
  // Diff actions (transient)
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

  // New Flow Modal actions (transient)
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

/**
 * Reload UI state from localStorage for the current workspace
 * Should be called when workspace.attached event fires
 */
export function reloadUiStateForWorkspace(): void {
  const persisted = loadUiState()
  useUiStore.setState({
    sessionPanelWidth: clampSessionPanelWidth(persisted.sessionPanelWidth),
    metaPanelWidth: persisted.metaPanelWidth ?? 300,
    metaPanelOpen: persisted.metaPanelOpen ?? false,
    debugPanelCollapsed: persisted.debugPanelCollapsed ?? false,
    debugPanelHeight: persisted.debugPanelHeight ?? 300,
    contextInspectorCollapsed: persisted.contextInspectorCollapsed ?? false,
    contextInspectorHeight: persisted.contextInspectorHeight ?? 200,
    tokensCostsCollapsed: persisted.tokensCostsCollapsed ?? false,
    tokensCostsHeight: persisted.tokensCostsHeight ?? 250,
    rightPaneCollapsed: persisted.rightPaneCollapsed ?? false,
    currentView: (persisted.currentView as ViewType) ?? 'welcome',
  })
  console.log('[ui] Reloaded UI state for workspace')
}

/**
 * Initialize UI event subscriptions
 */
export function initUiEvents(): void {
  // View is now derived from workspace attachment state
  // No need to subscribe to view changes
  console.log('[ui] UI events initialized (view derived from workspace state)')
}
