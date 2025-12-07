/**
 * Service-based RPC handlers
 *
 * This file provides RPC handler implementations using the new service architecture
 * instead of the old Zustand store.
 */

import type { ModelOption } from '../../store/types.js'
import {
  getSessionService,
  getFlowCacheService,
  getKanbanService,
  getProviderService,
  getSettingsService,
} from '../../services/index.js'
import type { RpcConnection } from './types.js'
import { getConnectionWorkspaceId } from './broadcast.js'

// Session handlers
export const sessionHandlers = {
  async getCurrent(workspaceId: string) {
    const sessionService = getSessionService()
    const sid = sessionService.getCurrentIdFor({ workspaceId })
    if (!sid) return null

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const sess = sessions.find((s) => s.id === sid)
    if (!sess) return null

    return {
      id: sess.id,
      title: sess.title,
      items: sess.items,
      currentContext: sess.currentContext,
      tokenUsage: sess.tokenUsage,
      costs: sess.costs,
    }
  },

  async list(workspaceId: string) {
    const sessionService = getSessionService()
    const list = sessionService.getSessionsFor({ workspaceId })
    const sessions = list.map((s) => ({ id: s.id, title: s.title }))
    const currentId = sessionService.getCurrentIdFor({ workspaceId })
    return { ok: true, sessions, currentId }
  },

  async select(workspaceId: string, id: string) {
    const sessionService = getSessionService()
    await sessionService.selectFor({ workspaceId, id })
    return { ok: true }
  },

  async newSession(workspaceId: string, title?: string) {
    const sessionService = getSessionService()
    const id = await sessionService.newSessionFor({ workspaceId, title })
    return { ok: true, id }
  },

  async getCurrentMeta(workspaceId: string) {
    const sessionService = getSessionService()
    const currentId = sessionService.getCurrentIdFor({ workspaceId })
    if (!currentId) return { ok: false, error: 'no-current-session' }

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const sess = sessions.find((s) => s.id === currentId)
    if (!sess) return { ok: false, error: 'no-session' }

    const executedFlowId = sess.executedFlow || sess.lastUsedFlow || ''
    return {
      ok: true,
      meta: {
        id: sess.id,
        title: sess.title,
        executedFlowId,
        lastUsedFlowId: sess.lastUsedFlow || '',
        providerId: sess.currentContext?.provider || '',
        modelId: sess.currentContext?.model || '',
      },
    }
  },

  async setExecutedFlow(workspaceId: string, sessionId: string, flowId: string) {
    const sessionService = getSessionService()
    await sessionService.setSessionExecutedFlowFor({ workspaceId, sessionId, flowId })
    return { ok: true }
  },

  async setProviderModel(workspaceId: string, sessionId: string, providerId: string, modelId: string) {
    const sessionService = getSessionService()
    await sessionService.setSessionProviderModelFor({ workspaceId, sessionId, provider: providerId, model: modelId })
    return { ok: true }
  },

  async startNewContext(workspaceId: string, sessionId: string) {
    const sessionService = getSessionService()
    await sessionService.resetCurrentContextFor({ workspaceId, sessionId })
    return { ok: true }
  },

  async getUsage(workspaceId: string) {
    const sessionService = getSessionService()
    const sid = sessionService.getCurrentIdFor({ workspaceId })
    if (!sid) return { ok: true, usage: null }

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const sess = sessions.find((s) => s.id === sid)
    if (!sess) return { ok: true, usage: null }

    return {
      ok: true,
      tokenUsage: sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} },
      costs: sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' },
      requestsLog: Array.isArray(sess.requestsLog) ? sess.requestsLog : [],
    }
  },
}

// Kanban handlers
export const kanbanHandlers = {
  async getBoard() {
    const kanbanService = getKanbanService()
    return {
      ok: true,
      board: kanbanService.getBoard(),
      loading: kanbanService.isLoading(),
      saving: kanbanService.isSaving(),
      error: kanbanService.getError(),
      lastLoadedAt: kanbanService.getLastLoadedAt(),
    }
  },

  async load(connection: RpcConnection) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanLoadFor(workspaceId)
    return { ok: true }
  },

  async refresh(connection: RpcConnection) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanRefreshFromDiskFor(workspaceId)
    return { ok: true }
  },

  async createTask(connection: RpcConnection, input: any) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    const task = await kanbanService.kanbanCreateTask({ ...(input || {}), workspaceId })
    return { ok: !!task, task: task || null }
  },

  async updateTask(connection: RpcConnection, taskId: string, patch: any) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    const task = await kanbanService.kanbanUpdateTask(taskId, patch || {}, workspaceId)
    return { ok: !!task, task: task || null }
  },

  async deleteTask(connection: RpcConnection, taskId: string) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanDeleteTask(taskId, workspaceId)
    return { ok: true }
  },

  async moveTask(connection: RpcConnection, taskId: string, toStatus: string, toIndex: number) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanMoveTask({ taskId, toStatus: toStatus as any, toIndex, workspaceId })
    return { ok: true }
  },

  async createEpic(connection: RpcConnection, input: any) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    const epic = await kanbanService.kanbanCreateEpic({ ...(input || {}), workspaceId })
    return { ok: !!epic, epic: epic || null }
  },

  async updateEpic(connection: RpcConnection, epicId: string, patch: any) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    const epic = await kanbanService.kanbanUpdateEpic(epicId, patch || {}, workspaceId)
    return { ok: !!epic, epic: epic || null }
  },

  async deleteEpic(connection: RpcConnection, epicId: string) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanDeleteEpic(epicId, workspaceId)
    return { ok: true }
  },

  async archiveTasks(connection: RpcConnection, olderThan: number) {
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'No workspace bound to connection' }
    }
    const kanbanService = getKanbanService()
    await kanbanService.kanbanArchiveTasks({ olderThan, workspaceId })
    return { ok: true }
  },
}

// Provider handlers
export const providerHandlers = {
  async refreshModels(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai') {
    const providerService = getProviderService()
    await providerService.refreshModels(provider)
    const models = providerService.getModelsForProvider(provider)
    return { ok: true, models }
  },

  async setDefaultModel(provider: string, model: string) {
    const providerService = getProviderService()
    providerService.setDefaultModel(provider, model)
    return { ok: true }
  },

  async setAutoRetry(value: boolean) {
    const providerService = getProviderService()
    providerService.setAutoRetry(value)
    return { ok: true }
  },

  async addFireworksModel(model: string) {
    const providerService = getProviderService()
    await providerService.addFireworksModel(model)
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  },

  async removeFireworksModel(model: string) {
    const providerService = getProviderService()
    await providerService.removeFireworksModel(model)
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  },

  async setSelectedProvider(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai') {
    const providerService = getProviderService()
    providerService.setSelectedProvider(provider)
    return {
      ok: true,
      selectedProvider: providerService.getSelectedProvider(),
      selectedModel: providerService.getSelectedModel(),
    }
  },

  async setSelectedModel(model: string) {
    const providerService = getProviderService()
    providerService.setSelectedModel(model)
    return { ok: true, selectedModel: providerService.getSelectedModel() }
  },

  async loadFireworksDefaults() {
    const providerService = getProviderService()
    await providerService.loadFireworksRecommendedDefaults()
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  },
}

// Settings handlers
export const settingsHandlers = {
  async get() {
    const settingsService = getSettingsService()
    const providerService = getProviderService()

    // Build providerValid object from individual provider checks
    const providerValid: Record<string, boolean> = {
      openai: providerService.getProviderValid('openai'),
      anthropic: providerService.getProviderValid('anthropic'),
      gemini: providerService.getProviderValid('gemini'),
      fireworks: providerService.getProviderValid('fireworks'),
      xai: providerService.getProviderValid('xai'),
    }

    // Build modelsByProvider object
    const modelsByProvider: Record<string, ModelOption[]> = {
      openai: providerService.getModelsForProvider('openai'),
      anthropic: providerService.getModelsForProvider('anthropic'),
      gemini: providerService.getModelsForProvider('gemini'),
      fireworks: providerService.getModelsForProvider('fireworks'),
      xai: providerService.getModelsForProvider('xai'),
    }

    // Build defaultModels object
    const defaultModels: Record<string, string | undefined> = {
      openai: providerService.getDefaultModel('openai'),
      anthropic: providerService.getDefaultModel('anthropic'),
      gemini: providerService.getDefaultModel('gemini'),
      fireworks: providerService.getDefaultModel('fireworks'),
      xai: providerService.getDefaultModel('xai'),
    }

    return {
      ok: true,
      settingsApiKeys: settingsService.getApiKeys(),
      settingsSaving: false, // SettingsService doesn't track saving state
      settingsSaved: false, // SettingsService doesn't track saved state
      providerValid,
      modelsByProvider,
      defaultModels,
      pricingConfig: settingsService.getPricingConfig(),
      defaultPricingConfig: settingsService.getDefaultPricingConfig(),
    }
  },

  async setApiKeys(apiKeys: Partial<any>) {
    const settingsService = getSettingsService()
    // SettingsService has individual setters, not a bulk setApiKeys method
    if (apiKeys.openai !== undefined) settingsService.setOpenAiApiKey(apiKeys.openai)
    if (apiKeys.anthropic !== undefined) settingsService.setAnthropicApiKey(apiKeys.anthropic)
    if (apiKeys.gemini !== undefined) settingsService.setGeminiApiKey(apiKeys.gemini)
    if (apiKeys.fireworks !== undefined) settingsService.setFireworksApiKey(apiKeys.fireworks)
    if (apiKeys.xai !== undefined) settingsService.setXaiApiKey(apiKeys.xai)
    return { ok: true }
  },

  async saveKeys() {
    // SettingsService doesn't have saveApiKeys - keys are saved automatically
    return { ok: true }
  },

  async validateKeys() {
    const settingsService = getSettingsService()
    const res = settingsService.getValidateResult()
    return res || { ok: true, failures: [] }
  },

  async clearResults() {
    const settingsService = getSettingsService()
    settingsService.clearSettingsResults()
    return { ok: true }
  },

  async resetPricingToDefaults() {
    const settingsService = getSettingsService()
    settingsService.resetPricingToDefaults()
    return {
      ok: true,
      pricingConfig: settingsService.getPricingConfig(),
      defaultPricingConfig: settingsService.getDefaultPricingConfig(),
    }
  },

  async resetProviderPricing(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai') {
    const settingsService = getSettingsService()
    settingsService.resetProviderPricing(provider)
    return { ok: true, pricingConfig: settingsService.getPricingConfig() }
  },

  async setPricingForModel(provider: string, model: string, pricing: any) {
    const settingsService = getSettingsService()
    settingsService.setPricingForModel(provider, model, pricing)
    return { ok: true, pricingConfig: settingsService.getPricingConfig() }
  },
}

// Flow handlers
export const flowHandlers = {
  async getNodeCache(workspaceId: string, sessionId: string, nodeId: string) {
    const flowCacheService = getFlowCacheService()
    const cache = flowCacheService.getNodeCacheFor({ workspaceId, sessionId, nodeId })
    return { ok: true, cache }
  },

  async clearNodeCache(workspaceId: string, sessionId: string, nodeId: string) {
    const flowCacheService = getFlowCacheService()
    await flowCacheService.clearNodeCacheFor({ workspaceId, sessionId, nodeId })
    return { ok: true }
  },
}

