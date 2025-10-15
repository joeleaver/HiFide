/**
 * Combined Zustand Store
 *
 * This file combines all store slices into a single unified store.
 * Uses the official Zustand slices pattern for modularity and maintainability.
 *
 * Architecture:
 * - Each slice is independent and focused on a specific domain
 * - Slices can access other slices via get() for cross-slice communication
 * - Type safety is maintained throughout with TypeScript
 * - Persistence is handled per-slice where needed
 *
 * Slices:
 * 1. View - Current view state (agent/explorer)
 * 2. UI - UI panel states and toggles
 * 3. Debug - Debug logging
 * 4. Planning - Approved plan management
 * 5. App - Application initialization
 * 6. Workspace - Workspace management
 * 7. Explorer - File explorer
 * 8. Indexing - Code indexing
 * 9. Provider - Provider/model selection
 * 10. Settings - Settings & API keys
 * 11. Terminal - Terminal & PTY management
 * 12. Session - Chat sessions & LLM lifecycle
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createViewSlice, type ViewSlice } from './slices/view.slice'
import { createUiSlice, type UiSlice } from './slices/ui.slice'
import { createDebugSlice, type DebugSlice } from './slices/debug.slice'
import { createPlanningSlice, type PlanningSlice } from './slices/planning.slice'
import { createAppSlice, type AppSlice } from './slices/app.slice'
import { createWorkspaceSlice, type WorkspaceSlice } from './slices/workspace.slice'
import { createExplorerSlice, type ExplorerSlice } from './slices/explorer.slice'
import { createIndexingSlice, type IndexingSlice } from './slices/indexing.slice'
import { createProviderSlice, type ProviderSlice } from './slices/provider.slice'
import { createSettingsSlice, type SettingsSlice } from './slices/settings.slice'
import { createTerminalSlice, type TerminalSlice } from './slices/terminal.slice'
import { createSessionSlice, type SessionSlice } from './slices/session.slice'
import { createFlowEditorSlice, type FlowEditorSlice } from './slices/flowEditor.slice'


// ============================================================================
// Combined Store Type
// ============================================================================

/**
 * Combined store type that includes all slices.
 * This provides full type safety across the entire application.
 */
export type AppStore = ViewSlice &
  UiSlice &
  DebugSlice &
  PlanningSlice &
  AppSlice &
  WorkspaceSlice &
  ExplorerSlice &
  IndexingSlice &
  ProviderSlice &
  SettingsSlice &
  TerminalSlice &
  SessionSlice &
  FlowEditorSlice

// ============================================================================
// Create Combined Store
// ============================================================================

/**
 * Main application store combining all slices.
 *
 * Uses Zustand's persist middleware to save specific state to localStorage.
 * Each slice manages its own persistence where needed.
 *
 * Cross-slice communication:
 * - Slices can access other slices via get() with type casting
 * - The combined store provides full type safety
 * - Dependencies are documented in each slice file
 */
export const useAppStore = create<AppStore>()(
  persist(
    (set, get, store) => ({
      // Simple Slices
      ...createViewSlice(set, get, store),
      ...createUiSlice(set, get, store),
      ...createDebugSlice(set, get, store),
      ...createPlanningSlice(set, get, store),

      // Medium Slices
      ...createAppSlice(set, get, store),
      ...createWorkspaceSlice(set, get, store),
      ...createExplorerSlice(set, get, store),
      ...createIndexingSlice(set, get, store),

      // Complex Slices
      ...createProviderSlice(set, get, store),
      ...createSettingsSlice(set, get, store),
      ...createTerminalSlice(set, get, store),
      ...createSessionSlice(set, get, store),
      ...createFlowEditorSlice(set, get, store),

    }),
    {
      name: 'hifide-app-storage',
      // Specify which parts of the state to persist
      partialize: (state) => ({
        // UI state
        metaPanelOpen: state.metaPanelOpen,
        sidebarCollapsed: state.sidebarCollapsed,
        debugPanelCollapsed: state.debugPanelCollapsed,
        agentTerminalPanelOpen: state.agentTerminalPanelOpen,
        agentTerminalPanelHeight: state.agentTerminalPanelHeight,
        explorerTerminalPanelOpen: state.explorerTerminalPanelOpen,
        explorerTerminalPanelHeight: state.explorerTerminalPanelHeight,

        // Pricing config
        pricingConfig: state.pricingConfig,

        // Note: Most other state is persisted individually by slices via localStorage
        // or via IPC to the main process (e.g., sessions, API keys, rate limits)
      }),
    }
  )
)

// ============================================================================
// Selectors
// ============================================================================

/**
 * Common selectors for performance optimization.
 * Use these to prevent unnecessary re-renders.
 */

// View selectors
export const selectCurrentView = (state: AppStore) => state.currentView

// UI selectors
export const selectMetaPanelOpen = (state: AppStore) => state.metaPanelOpen
export const selectSidebarCollapsed = (state: AppStore) => state.sidebarCollapsed
export const selectDebugPanelCollapsed = (state: AppStore) => state.debugPanelCollapsed

// Session selectors
export const selectCurrentSession = (state: AppStore) =>
  state.sessions.find((s) => s.id === state.currentId)
export const selectCurrentMessages = (state: AppStore) => state.getCurrentMessages()
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
export const selectExplorerTerminalPanelOpen = (state: AppStore) => state.explorerTerminalPanelOpen
export const selectExplorerTerminalPanelHeight = (state: AppStore) => state.explorerTerminalPanelHeight

// Rate limit selectors
export const selectRateLimitConfig = (state: AppStore) => state.rateLimitConfig

// Settings selectors
export const selectAutoRetry = (state: AppStore) => state.autoRetry
export const selectAutoEnforceEditsSchema = (state: AppStore) => state.autoEnforceEditsSchema
export const selectSettingsApiKeys = (state: AppStore) => state.settingsApiKeys
export const selectSettingsSaving = (state: AppStore) => state.settingsSaving
export const selectSettingsSaved = (state: AppStore) => state.settingsSaved
export const selectStartupMessage = (state: AppStore) => state.startupMessage

// Agent metrics selectors
export const selectAgentMetrics = (state: AppStore) => state.agentMetrics

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the store on app startup.
 * This should be called once when the app starts.
 */
let isInitializing = false
let isInitialized = false

export const initializeStore = async () => {
  // Prevent double initialization (React StrictMode calls useEffect twice in dev)
  if (isInitializing || isInitialized) {
    console.log('[store] Already initialized or initializing, skipping...')
    return
  }

  isInitializing = true
  const store = useAppStore.getState()

  console.log('[store] Initializing combined store...')

  try {
    // Register global flow event handler (FIRST - before any flow execution)
    console.log('[store] Registering global flow event handler...')
    store.registerGlobalFlowEventHandler()

    // Initialize app (loads workspace, API keys, sessions, etc.)
    await store.initializeApp()

    // Initialize Flow Editor slice (loads templates, persistence)
    await store.initFlowEditor()

    console.log('[store] Combined store initialized')
    isInitialized = true
  } finally {
    isInitializing = false
  }
}

// ============================================================================
// Exports
// ============================================================================

// Export types for use in components

export type {
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
}

// Re-export types from types.ts for convenience
export type {
  ViewType,
  ChatMessage,
  Session,
  TokenUsage,
  TokenCost,
  ModelOption,
  PtySession,
  TerminalInstance,
  PlanStep,
  ApprovedPlan,
  IndexStatus,
  IndexProgress,
  RouteRecord,
  ApiKeys,
  PricingConfig,
  RateLimitConfig,
  RateLimitKind,
  DebugLogEntry,
  RecentFolder,
  ExplorerEntry,
  OpenedFile,
  AgentMetrics,
  ActivityEvent,
} from './types'

