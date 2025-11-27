/**
 * Service-based RPC handlers
 * 
 * This file provides RPC handler implementations using the new service architecture
 * instead of the old Zustand store.
 */

import {
  getSessionService,
  getSessionTimelineService,
  getFlowCacheService,
  getKanbanService,
  getKnowledgeBaseService,
  getProviderService,
  getSettingsService,
  getWorkspaceService,
  getViewService,
  getUiService,
  getFlowExecutionService,
  getFlowProfileService,
  getFlowConfigService,
  getFlowGraphService,
} from '../../services/index.js'

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
      timeline: sess.timeline,
      currentContext: sess.currentContext,
      totalTokenUsage: sess.totalTokenUsage,
      totalCost: sess.totalCost,
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
    const id = sessionService.newSessionFor({ workspaceId, title })
    return { ok: true, id }
  },

  async getCurrentMeta(workspaceId: string) {
    const sessionService = getSessionService()
    const currentId = sessionService.getCurrentIdFor({ workspaceId })
    if (!currentId) return { ok: false, error: 'no-current-session' }

    const sessions = sessionService.getSessionsFor({ workspaceId })
    const sess = sessions.find((s) => s.id === currentId)
    if (!sess) return { ok: false, error: 'no-session' }

    return {
      ok: true,
      id: sess.id,
      title: sess.title,
      lastUsedFlow: sess.lastUsedFlow || '',
      providerId: sess.currentContext?.provider || '',
      modelId: sess.currentContext?.model || '',
    }
  },

  async setExecutedFlow(sessionId: string, flowId: string) {
    const sessionService = getSessionService()
    await sessionService.setSessionExecutedFlow({ sessionId, flowId })
    return { ok: true }
  },

  async setProviderModel(sessionId: string, providerId: string, modelId: string) {
    const sessionService = getSessionService()
    await sessionService.setSessionProviderModel({ sessionId, provider: providerId, model: modelId })
    return { ok: true }
  },

  async startNewContext() {
    const sessionTimelineService = getSessionTimelineService()
    await sessionTimelineService.startNewContext()
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

  async load() {
    const kanbanService = getKanbanService()
    await kanbanService.load()
    return { ok: true }
  },

  async refresh() {
    const kanbanService = getKanbanService()
    await kanbanService.refreshFromDisk()
    return { ok: true }
  },

  async save() {
    const kanbanService = getKanbanService()
    await kanbanService.save()
    return { ok: true }
  },

  async createTask(input: any) {
    const kanbanService = getKanbanService()
    const task = await kanbanService.createTask(input)
    return { ok: !!task, task: task || null }
  },

  async updateTask(taskId: string, patch: any) {
    const kanbanService = getKanbanService()
    const task = await kanbanService.updateTask(taskId, patch)
    return { ok: !!task, task: task || null }
  },

  async deleteTask(taskId: string) {
    const kanbanService = getKanbanService()
    await kanbanService.deleteTask(taskId)
    return { ok: true }
  },

  async moveTask(taskId: string, toStatus: string, toIndex: number) {
    const kanbanService = getKanbanService()
    await kanbanService.moveTask({ taskId, toStatus, toIndex })
    return { ok: true }
  },

  async createEpic(input: any) {
    const kanbanService = getKanbanService()
    const epic = await kanbanService.createEpic(input)
    return { ok: !!epic, epic: epic || null }
  },

  async updateEpic(epicId: string, patch: any) {
    const kanbanService = getKanbanService()
    const epic = await kanbanService.updateEpic(epicId, patch)
    return { ok: !!epic, epic: epic || null }
  },

  async deleteEpic(epicId: string) {
    const kanbanService = getKanbanService()
    await kanbanService.deleteEpic(epicId)
    return { ok: true }
  },

  async archiveTasks(olderThan: number) {
    const kanbanService = getKanbanService()
    await kanbanService.archiveTasks({ olderThan })
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
    providerService.setDefaultModel({ provider, model })
    return { ok: true }
  },

  async setAutoRetry(value: boolean) {
    const providerService = getProviderService()
    providerService.setAutoRetry(value)
    return { ok: true }
  },

  async addFireworksModel(model: string) {
    const providerService = getProviderService()
    providerService.addFireworksModel({ model })
    return { ok: true }
  },

  async removeFireworksModel(model: string) {
    const providerService = getProviderService()
    providerService.removeFireworksModel({ model })
    return { ok: true }
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
    providerService.loadFireworksRecommendedDefaults()
    return { ok: true }
  },
}

// Settings handlers
export const settingsHandlers = {
  async get() {
    const settingsService = getSettingsService()
    const providerService = getProviderService()
    return {
      ok: true,
      settingsApiKeys: settingsService.getApiKeys(),
      settingsSaving: settingsService.isSaving(),
      settingsSaved: settingsService.isSaved(),
      providerValid: settingsService.getProviderValid(),
      modelsByProvider: providerService.getModelsByProvider(),
      defaultModels: providerService.getDefaultModels(),
      pricingConfig: settingsService.getPricingConfig(),
      defaultPricingConfig: settingsService.getDefaultPricingConfig(),
    }
  },

  async setApiKeys(apiKeys: Partial<any>) {
    const settingsService = getSettingsService()
    settingsService.setApiKeys(apiKeys)
    return { ok: true }
  },

  async saveKeys() {
    const settingsService = getSettingsService()
    await settingsService.saveApiKeys()
    return { ok: true }
  },

  async validateKeys() {
    const settingsService = getSettingsService()
    const res = await settingsService.validateApiKeys()
    return res || { ok: true, failures: [] }
  },

  async clearResults() {
    const settingsService = getSettingsService()
    settingsService.clearResults()
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
    settingsService.setPricingForModel({ provider, model, pricing })
    return { ok: true, pricingConfig: settingsService.getPricingConfig() }
  },
}

// Flow handlers
export const flowHandlers = {
  async getNodeCache(nodeId: string) {
    const flowCacheService = getFlowCacheService()
    const cache = flowCacheService.getNodeCache(nodeId)
    return { ok: true, cache }
  },

  async clearNodeCache(nodeId: string) {
    const flowCacheService = getFlowCacheService()
    await flowCacheService.clearNodeCache(nodeId)
    return { ok: true }
  },
}

