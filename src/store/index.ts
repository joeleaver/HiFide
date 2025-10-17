/**
 * Renderer Process Store Bridge
 * 
 * This creates a synced copy of the main process store in the renderer.
 * All state updates are automatically synchronized via IPC.
 * 
 * Usage:
 * - Import `useAppStore` from this file instead of './index'
 * - The API is identical to the original Zustand store
 * - State changes in main process are automatically reflected here
 * - Actions called here are sent to main process via IPC
 */

import { createUseStore, useDispatch as useZubridgeDispatch } from '@zubridge/electron'
import type { AppStore } from '../../electron/store'

// Re-export types that are used by components
export type { ViewType, ModelPricing, PricingConfig } from '../../electron/store/types'
export type { RateLimitKind } from '../../electron/store/types'

/**
 * Create the renderer-side store hook
 * This is a synced copy of the main process store
 */
export const useAppStore = createUseStore<AppStore>()

/**
 * Create a typed dispatch hook for calling store actions
 * Use this to call any action methods on the store from the renderer
 *
 * Example:
 *   const dispatch = useDispatch()
 *   dispatch('toggleRateLimiting', true)
 *   dispatch('setRateLimitForModel', 'openai', 'gpt-4', { rpm: 100 })
 */
export const useDispatch = () => useZubridgeDispatch<AppStore>()

/**
 * Re-export all selectors for convenience
 * These work exactly the same as before
 */

// View selectors
export const selectCurrentView = (state: AppStore) => state.currentView

// UI selectors - read from windowState
export const selectMetaPanelOpen = (state: AppStore) => state.windowState.metaPanelOpen
export const selectSidebarCollapsed = (state: AppStore) => state.windowState.sidebarCollapsed
export const selectDebugPanelCollapsed = (state: AppStore) => state.windowState.debugPanelCollapsed

// Session selectors
export const selectCurrentSession = (state: AppStore) =>
  state.sessions.find((s) => s.id === state.currentId)
export const selectCurrentMessages = (state: AppStore) => {
  const currentSession = state.sessions.find((s) => s.id === state.currentId)
  return currentSession?.items.filter(i => i.type === 'message').map((i: any) => ({
    role: i.role,
    content: i.content
  })) || []
}
export const selectSessions = (state: AppStore) => state.sessions
export const selectCurrentId = (state: AppStore) => state.currentId

// Provider selectors
export const selectSelectedProvider = (state: AppStore) => state.selectedProvider
export const selectSelectedModel = (state: AppStore) => state.selectedModel
export const selectProviderValid = (state: AppStore) => state.providerValid
export const selectModelsByProvider = (state: AppStore) => state.modelsByProvider
export const selectDefaultModels = (state: AppStore) => state.defaultModels

// Workspace selectors
export const selectWorkspaceRoot = (state: AppStore) => state.workspaceRoot
export const selectRecentFolders = (state: AppStore) => state.recentFolders

// Terminal selectors
export const selectAgentTerminalTabs = (state: AppStore) => state.agentTerminalTabs
export const selectAgentActiveTerminal = (state: AppStore) => state.agentActiveTerminal
export const selectExplorerTerminalTabs = (state: AppStore) => state.explorerTerminalTabs
export const selectExplorerActiveTerminal = (state: AppStore) => state.explorerActiveTerminal

// Explorer selectors
export const selectExplorerTree = (state: AppStore) => state.explorerChildrenByDir
export const selectOpenedFile = (state: AppStore) => state.openedFile

// Indexing selectors
export const selectIndexStatus = (state: AppStore) => state.idxStatus
export const selectIndexProgress = (state: AppStore) => state.idxProg
export const selectIndexQuery = (state: AppStore) => state.idxQuery
export const selectIndexResults = (state: AppStore) => state.idxResults

// Debug selectors
export const selectDebugLogs = (state: AppStore) => state.debugLogs

// Planning selectors
export const selectApprovedPlan = (state: AppStore) => state.approvedPlan

// Settings selectors
export const selectAutoApproveEnabled = (state: AppStore) => state.autoApproveEnabled
export const selectAutoApproveThreshold = (state: AppStore) => state.autoApproveThreshold
export const selectPricingConfig = (state: AppStore) => state.pricingConfig
export const selectDefaultPricingConfig = (state: AppStore) => state.defaultPricingConfig

// LLM Request selectors
export const selectCurrentRequestId = (state: AppStore) => state.currentRequestId
export const selectStreamingText = (state: AppStore) => state.streamingText
export const selectLastRequestTokenUsage = (state: AppStore) => state.lastRequestTokenUsage
export const selectLastRequestSavings = (state: AppStore) => state.lastRequestSavings

// Context selectors
export const selectCtxRefreshing = (state: AppStore) => state.ctxRefreshing
export const selectCtxResult = (state: AppStore) => state.ctxResult

// Explorer selectors
export const selectExplorerOpenFolders = (state: AppStore) => state.explorerOpenFolders
export const selectExplorerChildrenByDir = (state: AppStore) => state.explorerChildrenByDir
export const selectExplorerTerminalPanelOpen = (state: AppStore) => state.windowState.explorerTerminalPanelOpen
export const selectExplorerTerminalPanelHeight = (state: AppStore) => state.windowState.explorerTerminalPanelHeight

// Rate limit selectors
export const selectRateLimitConfig = (state: AppStore) => state.rateLimitConfig

// Settings selectors
export const selectAutoRetry = (state: AppStore) => state.autoRetry
export const selectSettingsApiKeys = (state: AppStore) => state.settingsApiKeys
export const selectSettingsSaving = (state: AppStore) => state.settingsSaving
export const selectSettingsSaved = (state: AppStore) => state.settingsSaved
export const selectStartupMessage = (state: AppStore) => state.startupMessage

// Agent metrics selectors
export const selectAgentMetrics = (state: AppStore) => state.agentMetrics

/**
 * Note: No initialization function needed!
 * The store is automatically initialized by the main process.
 * The renderer just subscribes to updates.
 */

// Re-export all types from the main store for convenience
export type {
  AppStore,
  ViewSlice,
  UiSlice,
  DebugSlice,
  PlanningSlice,
  AppSlice,
  WorkspaceSlice,
  ExplorerSlice,
  IndexingSlice,
  ProviderSlice,
  SettingsSlice,
  TerminalSlice,
  SessionSlice,
  FlowEditorSlice,
} from '../../electron/store'

// Re-export all other types
export type {
  SessionMessage,
  SessionBadgeGroup,
  SessionItem,
  Session,
  TokenUsage,
  TokenCost,
  ModelOption,
  PtySession,
  PlanStep,
  ApprovedPlan,
  IndexStatus,
  IndexProgress,
  RouteRecord,
  ApiKeys,
  PricingConfig,
  RateLimitConfig,
  DebugLogEntry,
  RecentFolder,
  ExplorerEntry,
  OpenedFile,
  AgentMetrics,
  ActivityEvent,
} from '../../electron/store/types'
