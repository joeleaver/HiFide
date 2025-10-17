/**
 * Main Process Zustand Store
 * 
 * This is the single source of truth for application state.
 * The renderer process will sync with this store via @zubridge/electron.
 * 
 * Architecture:
 * - Main process owns the store and can directly read/write
 * - Renderer process gets a synced copy via zubridge
 * - Actions from renderer are sent via IPC to main, which updates the store
 * - Store updates are automatically broadcast to all renderer windows
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
// NOTE: Terminal slice is renderer-only (uses xterm which is browser-specific)
import type { TerminalSlice } from './slices/terminal.slice'
import { createSessionSlice, type SessionSlice } from './slices/session.slice'
import { createFlowEditorSlice, type FlowEditorSlice } from './slices/flowEditor.slice'
import { electronStorage } from './storage'

// Combined store type
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

/**
 * Main process store - single source of truth
 *
 * This store is identical to the renderer store but lives in the main process.
 * The renderer will get a synced copy via zubridge.
 *
 * Uses persist middleware with electron-store backend for Node.js-compatible persistence.
 */
export const useMainStore = create<AppStore>()(
  persist(
    (set, get, store) => {

      return {
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
        // NOTE: Terminal slice is renderer-only - stub out all methods for main process
        agentTerminalTabs: [],
        agentActiveTerminal: null,
        explorerTerminalTabs: [],
        explorerActiveTerminal: null,
        agentSessionTerminals: {},
        ptyInitialized: false,
        ptySessions: {},
        ptyBySessionId: {},
        ptySubscribers: {},
        addTerminalTab: () => '',
        removeTerminalTab: () => {},
        setActiveTerminal: () => {},
        clearAgentTerminals: async () => {},
        clearExplorerTerminals: async () => {},
        mountTerminal: async () => {},
        remountTerminal: () => {},
        unmountTerminal: () => {},
        fitTerminal: () => {},
        fitAllTerminals: () => {},
        ensurePtyInfra: () => {},
        ensurePtySession: async () => ({ sessionId: '' }),
        writePty: async () => ({ ok: false }),
        resizePty: async () => ({ ok: false }),
        disposePty: async () => ({ ok: false }),
        subscribePtyData: () => () => {},
        ...createSessionSlice(set, get, store),
        ...createFlowEditorSlice(set, get, store),
      }
    },
    {
      name: 'hifide-store',
      storage: createJSONStorage(() => electronStorage),
      // Only persist specific slices - exclude transient/runtime state
      partialize: (state) => ({
        // UI preferences - single windowState object
        currentView: state.currentView,
        windowState: state.windowState,

        // Provider/model selection
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        autoRetry: state.autoRetry,
        defaultModels: state.defaultModels,
        routeHistory: state.routeHistory,

        // Settings
        settingsApiKeys: state.settingsApiKeys,
        autoApproveEnabled: state.autoApproveEnabled,
        autoApproveThreshold: state.autoApproveThreshold,
        pricingConfig: state.pricingConfig,

        // Workspace
        workspaceRoot: state.workspaceRoot,
        recentFolders: state.recentFolders,

        // Sessions (list and current ID, but not runtime state)
        sessions: state.sessions,
        currentId: state.currentId,

        // Flow editor (graph state, but not execution state)
        feNodes: state.feNodes,
        feEdges: state.feEdges,
        feNodePositions: state.feNodePositions,
        feInput: state.feInput,
        // NOTE: feSelectedTemplate is NOT persisted globally - it comes from session.lastUsedFlow
        feErrorDetectPatterns: state.feErrorDetectPatterns,
        feRetryAttempts: state.feRetryAttempts,
        feRetryBackoffMs: state.feRetryBackoffMs,
        feCacheEnabled: state.feCacheEnabled,
        feRedactorEnabled: state.feRedactorEnabled,
        feRuleEmails: state.feRuleEmails,
        feRuleApiKeys: state.feRuleApiKeys,
        feRuleAwsKeys: state.feRuleAwsKeys,
        feRuleNumbers16: state.feRuleNumbers16,
        feBudgetUSD: state.feBudgetUSD,
        feBudgetBlock: state.feBudgetBlock,
        feErrorDetectEnabled: state.feErrorDetectEnabled,
        feErrorDetectBlock: state.feErrorDetectBlock,

        // NOTE: We explicitly exclude transient state like:
        // - appBootstrapping, startupMessage
        // - streamingText, activeTools, currentRequestId
        // - feStatus, feRequestId, feEvents, feLog, feStreamingText, feActiveTools
        // - providerValid, modelsByProvider (these are loaded at runtime)
        // - indexing state, explorer state, planning state
      }),
      onRehydrateStorage: () => () => {
      },
    }
  )
)

/**
 * Initialize the main store
 * Called once when the app starts
 */
export const initializeMainStore = async () => {
  const store = useMainStore.getState()

  try {
    // NOTE: registerGlobalFlowEventHandler is renderer-only (uses window)
    // It will be called by the renderer when it initializes

    // Initialize app (loads workspace, API keys, sessions, etc.)
    await store.initializeApp()

    // Initialize Flow Editor slice (loads templates, persistence)
    await store.initFlowEditor()

  } catch (error) {
    console.error('[main-store] Failed to initialize:', error)
    throw error
  }
}

// Export all slice types for use in renderer
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
  SessionMessage,
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
  RateLimitKind,
  DebugLogEntry,
  RecentFolder,
  ExplorerEntry,
  OpenedFile,
  AgentMetrics,
  ActivityEvent,
} from './types'
