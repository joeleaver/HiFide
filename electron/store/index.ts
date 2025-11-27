/**
 * Main Process Zustand Store
 *
 * This is the single source of truth for application state.
 * Renderer communicates with this store via JSON‑RPC over WebSocket.
 *
 * Architecture:
 * - Main process owns the store and can directly read/write
 * - Renderer process does NOT hold a mirrored store
 * - Renderer hydrates snapshots and receives notifications via JSON‑RPC
 * - Renderer maintains small UI-only local stores; all domain mutations call RPCs
 */

import { create } from 'zustand'
import { persist, createJSONStorage, subscribeWithSelector } from 'zustand/middleware'
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
import { createToolsSlice, type ToolsSlice } from './slices/tools.slice'
import { createKanbanSlice, type KanbanSlice } from './slices/kanban.slice'
// NOTE: Terminal slice is renderer-only (uses xterm which is browser-specific)
import type { TerminalSlice } from './slices/terminal.slice'
import { createSessionSlice, type SessionSlice } from './slices/session.slice'
import { createKnowledgeBaseSlice, type KnowledgeBaseSlice } from './slices/knowledgeBase.slice'
import { electronStorage } from './storage'

import { getIndexer, getKbIndexer } from '../core/state'
import * as agentPty from '../services/agentPty'


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
  ToolsSlice &
  KanbanSlice &
  TerminalSlice &
  SessionSlice &
  KnowledgeBaseSlice

/**
 * Main process store - single source of truth
 *
 * Domain state lives only in the main process. The renderer queries and mutates
 * via JSON-RPC; there is no mirrored store in the renderer.
 *
 * Uses persist middleware with electron-store backend for Node.js-compatible persistence.
 */
export const useMainStore = create<AppStore>()(
  subscribeWithSelector(
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
        ...createToolsSlice(set, get, store),
        ...createKanbanSlice(set as any, get as any, store as any),
        // NOTE: Terminal slice - state management works in main, xterm operations are renderer-only
        agentTerminalTabs: [],
        agentActiveTerminal: null,
        explorerTerminalTabs: [],
        explorerActiveTerminal: null,
        agentSessionTerminals: {},
        ptyInitialized: false,
        ptySessions: {},
        ptyBySessionId: {},
        ptySubscribers: {},
        // State management actions - work in main process
        addTerminalTab: (context: 'agent' | 'explorer') => {
          const prefix = context === 'agent' ? 'a' : 'e'
          const tabId = `${prefix}${crypto.randomUUID().slice(0, 7)}`

          if (context === 'agent') {
            const state = get()
            set({
              agentTerminalTabs: [...state.agentTerminalTabs, tabId],
              agentActiveTerminal: tabId,
            })
          } else {
            const state = get()
            set({
              explorerTerminalTabs: [...state.explorerTerminalTabs, tabId],
              explorerActiveTerminal: tabId,
            })
          }

          return tabId
        },
        removeTerminalTab: ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
          const state = get()

          if (context === 'agent') {
            const tabs = state.agentTerminalTabs.filter((id) => id !== tabId)
            const active = state.agentActiveTerminal === tabId ? (tabs[0] || null) : state.agentActiveTerminal
            set({ agentTerminalTabs: tabs, agentActiveTerminal: active })
          } else {
            const tabs = state.explorerTerminalTabs.filter((id) => id !== tabId)
            const active = state.explorerActiveTerminal === tabId ? (tabs[0] || null) : state.explorerActiveTerminal
            set({ explorerTerminalTabs: tabs, explorerActiveTerminal: active })
          }
        },
        setActiveTerminal: ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string | null }) => {
          if (context === 'agent') {
            set({ agentActiveTerminal: tabId })
          } else {
            set({ explorerActiveTerminal: tabId })
          }
        },
        restartAgentTerminal: async (_params: { tabId: string }) => {
          // Get the current session ID to find the PTY
          const state = get() as any
          const ws = state.workspaceRoot || null
          const currentSessionId = (ws && typeof state.getCurrentIdFor === 'function')
            ? state.getCurrentIdFor({ workspaceId: ws })
            : null

          if (!currentSessionId) {
            console.error('[terminal] Cannot restart - no current session')
            return
          }

          console.log('[terminal] Restarting agent PTY for session:', currentSessionId)
          try {
            // Dispose existing PTY (if any). Renderer will reattach and backend will create if needed.
            agentPty.dispose(currentSessionId)
            console.log('[terminal] Agent PTY disposed; renderer will reattach and recreate as needed')
          } catch (e) {
            console.error('[terminal] Failed to dispose PTY:', e)
          }
        },
        clearAgentTerminals: async () => {
          // Just clear state - renderer will handle cleanup
          set({ agentTerminalTabs: [], agentActiveTerminal: null })

          // Enforce at least one agent terminal after clearing
          const newId = `a${crypto.randomUUID().slice(0, 7)}`
          set({ agentTerminalTabs: [newId], agentActiveTerminal: newId })
        },
        clearExplorerTerminals: async () => {
          // Just clear state - renderer will handle cleanup
          set({ explorerTerminalTabs: [], explorerActiveTerminal: null })
        },
        ensureSessionTerminal: async () => {
          const state = get() as any
          const ws = state.workspaceRoot || null
          const currentSessionId = (ws && typeof state.getCurrentIdFor === 'function')
            ? state.getCurrentIdFor({ workspaceId: ws })
            : null

          if (!currentSessionId) {
            console.warn('[terminal] ensureSessionTerminal: no current session')
            return
          }

          const existingTabs = state.agentTerminalTabs || []

          if (existingTabs.length === 0) {
            const tabId = `a${crypto.randomUUID().slice(0, 7)}`
            set({
              agentTerminalTabs: [tabId],
              agentActiveTerminal: tabId,
            })
            console.log('[terminal] Created session terminal:', tabId, 'for session:', currentSessionId)
          } else {
            if (!state.agentActiveTerminal) {
              set({ agentActiveTerminal: existingTabs[0] })
            }
            console.log('[terminal] Session terminal already exists:', existingTabs[0])
          }
        },
        // xterm-specific actions - stubs for main process
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
        ...createKnowledgeBaseSlice(set, get, store),
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
        // Fireworks models allowlist (user-configurable)
        fireworksAllowedModels: (state as any).fireworksAllowedModels,

        // Settings
        settingsApiKeys: state.settingsApiKeys,

        // NOTE: pricingConfig is NOT persisted - always initialized from DEFAULT_PRICING
        // This ensures new models are available immediately without requiring app restart


        // Indexing (persist only config/telemetry we care about)
        idxAutoRefresh: (state as any).idxAutoRefresh,
        idxLastRebuildAt: (state as any).idxLastRebuildAt,

        // Workspace
        workspaceRoot: state.workspaceRoot,
        recentFolders: state.recentFolders,

        // Sessions (persist workspace-scoped only)
        sessionsByWorkspace: (state as any).sessionsByWorkspace,
        currentIdByWorkspace: (state as any).currentIdByWorkspace,

        // Planning
        approvedPlan: state.approvedPlan,

        // Flow editor (graph state, but not execution state)
        feNodes: state.feNodes,
        feEdges: state.feEdges,
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
      onRehydrateStorage: () => (state) => {
        // workspaceRoot is now the single source of truth
        if (state?.workspaceRoot) {
          console.log('[store] Restored workspaceRoot from persistence:', state.workspaceRoot)
        }
      },
    }
    )
  )
)

// Development-only: log actual main-store mutations to distinguish renderer heartbeat resyncs
if (process.env.NODE_ENV !== 'production') {
  try {
    // Minimal shallow diff to see which top-level keys truly change in MAIN
    const shallowDiff = (a: any, b: any): string[] => {
      const keys = new Set<string>([...Object.keys(a || {}), ...Object.keys(b || {})])
      const changed: string[] = []
      for (const k of keys) {
        if ((a as any)?.[k] !== (b as any)?.[k]) changed.push(k)
      }
      return changed
    }
    ;(useMainStore as any).subscribe?.((next: any, prev: any) => {
      const diffs = shallowDiff(prev, next)
      if (!diffs.length) return
      // Suppress high-churn indexing keys to avoid console spam in development
      const suppressed = new Set(['idxStatus', 'idxProg'])
      const filtered = diffs.filter((k) => !suppressed.has(k))
      if (filtered.length) {
        console.debug('🗂️ [main-store] changed keys:', filtered)
      }
      // If only suppressed keys changed, do not log
    })
  } catch {}
}


/**
 * Initialize the main store
 * Called once when the app starts
 */
export const initializeMainStore = async () => {
  const store = useMainStore.getState()

  try {
    // Initialize new service architecture (Phase 1: debug, view, ui)
    const { initializeServices } = await import('../services/index.js')
    initializeServices()

    // NOTE: registerGlobalFlowEventHandler is renderer-only (uses window)
    // It will be called by the renderer when it initializes

    // Initialize app (loads workspace, API keys, sessions, etc.)
    await store.initializeApp()

    // Start index watchers (workspace + KB) - best effort (only when a workspace is set)
    if (useMainStore.getState().workspaceRoot) {
      try { (await getIndexer()).startWatch() } catch {}
      try { (await getKbIndexer()).startWatch() } catch {}
      // Ensure KB index exists/ready at startup (non-blocking)
      try {
        const kb = await getKbIndexer()
        const s = kb.status()
        if (!s.inProgress && (!s.exists || !s.ready)) {
          kb.rebuild(() => {}).catch(() => {})
        }
      } catch {}
    }

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
  DebugLogEntry,
  RecentFolder,
  ExplorerEntry,
  OpenedFile,
  AgentMetrics,
  ActivityEvent,
  KanbanStatus,
  KanbanTask,
  KanbanEpic,
  KanbanBoard,
} from './types'
