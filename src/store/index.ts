/**
 * Renderer Process Store Bridge
 *
 * Creates a synced copy of the main-process Zustand store in the renderer.
 */

import { useMemo } from 'react'
import { createUseStore, useDispatch as useZubridgeDispatch } from '@zubridge/electron'
import type { AppStore } from '../../electron/store'
import type { KanbanStatus } from '../../electron/store/types'

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
  ModelPricing,
} from '../../electron/store/types'

export const useAppStore = createUseStore<AppStore>()

export const useDispatch = () => {
  const base = useZubridgeDispatch<AppStore>()
  return useMemo(() => {
    return (async (action: keyof AppStore & string, ...args: any[]) => {
      const start = Date.now()
      try {
        return await (base as any)(action, ...args)
      } catch (error) {
        console.error('[zubridge] dispatch error', { action, elapsedMs: Date.now() - start, error })
        throw error
      }
    }) as typeof base
  }, [base])
}

export const selectCurrentView = (state: AppStore) => state.currentView
export const selectWorkspaceRoot = (state: AppStore) => state.workspaceRoot
export const selectRecentFolders = (state: AppStore) => state.recentFolders

export const selectKanbanBoard = (state: AppStore) => state.kanbanBoard
export const selectKanbanLoading = (state: AppStore) => state.kanbanLoading
export const selectKanbanSaving = (state: AppStore) => state.kanbanSaving
export const selectKanbanError = (state: AppStore) => state.kanbanError
export const selectKanbanEpics = (state: AppStore) => state.kanbanBoard?.epics ?? []
export const selectKanbanEpicById = (epicId: string) => (state: AppStore) =>
  state.kanbanBoard?.epics.find((epic) => epic.id === epicId) ?? null
export const selectKanbanTasksByStatus = (status: KanbanStatus) => (state: AppStore) =>
  state.kanbanBoard?.tasks
    .filter((task) => task.status === status)
    .sort((a, b) => a.order - b.order) ?? []

export const selectSessions = (state: AppStore) => state.sessions
export const selectCurrentSession = (state: AppStore) => state.sessions.find((session) => session.id === state.currentId) ?? null
export const selectCurrentId = (state: AppStore) => state.currentId

export const selectSelectedProvider = (state: AppStore) => state.selectedProvider
export const selectSelectedModel = (state: AppStore) => state.selectedModel
export const selectProviderValid = (state: AppStore) => state.providerValid
export const selectModelsByProvider = (state: AppStore) => state.modelsByProvider
export const selectDefaultModels = (state: AppStore) => state.defaultModels

export const selectPricingConfig = (state: AppStore) => state.pricingConfig
export const selectDefaultPricingConfig = (state: AppStore) => state.defaultPricingConfig

export const selectCurrentRequestId = (state: AppStore) => state.currentRequestId
export const selectStreamingText = (state: AppStore) => state.streamingText
export const selectLastRequestTokenUsage = (state: AppStore) => state.lastRequestTokenUsage
export const selectLastRequestSavings = (state: AppStore) => state.lastRequestSavings

export const selectExplorerTree = (state: AppStore) => state.explorerChildrenByDir
export const selectExplorerChildrenByDir = (state: AppStore) => state.explorerChildrenByDir
export const selectOpenedFile = (state: AppStore) => state.openedFile
export const selectExplorerOpenFolders = (state: AppStore) => state.explorerOpenFolders
export const selectExplorerTerminalTabs = (state: AppStore) => state.explorerTerminalTabs
export const selectExplorerActiveTerminal = (state: AppStore) => state.explorerActiveTerminal
export const selectExplorerTerminalPanelOpen = (state: AppStore) => state.windowState?.explorerTerminalPanelOpen ?? false
export const selectExplorerTerminalPanelHeight = (state: AppStore) => state.windowState?.explorerTerminalPanelHeight ?? 300

export const selectAgentTerminalTabs = (state: AppStore) => state.agentTerminalTabs
export const selectAgentActiveTerminal = (state: AppStore) => state.agentActiveTerminal

export const selectIndexStatus = (state: AppStore) => state.idxStatus
export const selectIndexProgress = (state: AppStore) => state.idxProg
export const selectIndexQuery = (state: AppStore) => state.idxQuery
export const selectIndexResults = (state: AppStore) => state.idxResults

export const selectDebugLogs = (state: AppStore) => state.debugLogs
export const selectApprovedPlan = (state: AppStore) => state.approvedPlan

export const selectStartupMessage = (state: AppStore) => state.startupMessage
export const selectAgentMetrics = (state: AppStore) => state.agentMetrics

// Settings selectors
export const selectAutoRetry = (state: AppStore) => state.autoRetry
export const selectSettingsApiKeys = (state: AppStore) => state.settingsApiKeys
export const selectSettingsSaving = (state: AppStore) => state.settingsSaving
export const selectSettingsSaved = (state: AppStore) => state.settingsSaved
