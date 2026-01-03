/**
 * Settings and Provider RPC handlers
 */

import type { ModelOption } from '../../../store/types.js'
import type { SettingsSnapshot, SettingsSnapshotResponse } from '../../../types/settings.js'
import { getSettingsService, getProviderService, getAppService } from '../../../services/index.js'

function buildSettingsSnapshot(): SettingsSnapshot {
  const settingsService = getSettingsService()
  const providerService = getProviderService()
  const appService = getAppService()

  const providerValid: Record<string, boolean> = {
    openai: providerService.getProviderValid('openai'),
    anthropic: providerService.getProviderValid('anthropic'),
    gemini: providerService.getProviderValid('gemini'),
    fireworks: providerService.getProviderValid('fireworks'),
    xai: providerService.getProviderValid('xai'),
    openrouter: providerService.getProviderValid('openrouter'),
  }

  const modelsByProvider: Record<string, ModelOption[]> = {
    openai: providerService.getModelsForProvider('openai'),
    anthropic: providerService.getModelsForProvider('anthropic'),
    gemini: providerService.getModelsForProvider('gemini'),
    fireworks: providerService.getModelsForProvider('fireworks'),
    xai: providerService.getModelsForProvider('xai'),
    openrouter: providerService.getModelsForProvider('openrouter'),
  }

  // Always-on diagnostics to identify unexpected wide model catalogs.
  try {
    const openaiIds = (modelsByProvider.openai || []).map((m) => m.value)
    const defaults = settingsService.getDefaultPricingConfig() as any
    const defaultOpenaiIds = Object.keys(defaults?.openai || {})
    const extra = openaiIds.filter((id) => !defaultOpenaiIds.includes(id))
    console.log('[settings.get] modelsByProvider counts', {
      openai: openaiIds.length,
      anthropic: (modelsByProvider.anthropic || []).length,
      gemini: (modelsByProvider.gemini || []).length,
      fireworks: (modelsByProvider.fireworks || []).length,
      xai: (modelsByProvider.xai || []).length,
      openrouter: (modelsByProvider.openrouter || []).length,
    })
    console.log('[settings.get] defaultPricingConfig counts', {
      openai: defaultOpenaiIds.length,
      anthropic: Object.keys(defaults?.anthropic || {}).length,
      gemini: Object.keys(defaults?.gemini || {}).length,
      fireworks: Object.keys(defaults?.fireworks || {}).length,
      xai: Object.keys(defaults?.xai || {}).length,
      openrouter: Object.keys(defaults?.openrouter || {}).length,
    })
    console.log('[settings.get] defaultPricingConfig.openai keys (first 30)', defaultOpenaiIds.slice(0, 30))
    console.log('[settings.get] openai extra vs defaults (first 20)', extra.slice(0, 20))
  } catch (e) {
    console.warn('[settings.get] diagnostics failed', e)
  }

  const defaultModels: Record<string, string | undefined> = {
    openai: providerService.getDefaultModel('openai'),
    anthropic: providerService.getDefaultModel('anthropic'),
    gemini: providerService.getDefaultModel('gemini'),
    fireworks: providerService.getDefaultModel('fireworks'),
    xai: providerService.getDefaultModel('xai'),
    openrouter: providerService.getDefaultModel('openrouter'),
  }

  return {
    settingsApiKeys: settingsService.getApiKeys(),
    settingsSaving: false,
    settingsSaved: false,
    providerValid,
    modelsByProvider,
    defaultModels,
    selectedProvider: providerService.getSelectedProvider(),
    selectedModel: providerService.getSelectedModel(),
    fireworksAllowedModels: providerService.getFireworksAllowedModels(),
    openrouterAllowedModels: providerService.getOpenRouterAllowedModels(),
    startupMessage: appService.getStartupMessage(),
    pricingConfig: settingsService.getPricingConfig(),
    defaultPricingConfig: settingsService.getDefaultPricingConfig(),
  }
}

/**
 * Create settings and provider RPC handlers
 */
export function createSettingsHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void
) {
  // Settings handlers
  addMethod('settings.get', async (): Promise<SettingsSnapshotResponse> => ({
    ok: true,
    ...buildSettingsSnapshot(),
  }))

  addMethod('settings.setApiKeys', async ({ apiKeys }: { apiKeys: Partial<any> }) => {    const settingsService = getSettingsService()
    
    if (apiKeys.openai !== undefined) settingsService.setOpenAiApiKey(apiKeys.openai)
    if (apiKeys.anthropic !== undefined) settingsService.setAnthropicApiKey(apiKeys.anthropic)
    if (apiKeys.gemini !== undefined) settingsService.setGeminiApiKey(apiKeys.gemini)
    if (apiKeys.fireworks !== undefined) settingsService.setFireworksApiKey(apiKeys.fireworks)
    if (apiKeys.xai !== undefined) settingsService.setXaiApiKey(apiKeys.xai)
    if (apiKeys.openrouter !== undefined) settingsService.setOpenRouterApiKey(apiKeys.openrouter)
    
    return { ok: true }
  })

  addMethod('settings.saveKeys', async () => {
    // Keys are saved automatically by SettingsService
    return { ok: true }
  })

  addMethod('settings.validateKeys', async () => {
    const settingsService = getSettingsService()
    // validateApiKeys updates ProviderService providerValid map internally.
    return await settingsService.validateApiKeys()
  })

  addMethod('settings.clearResults', async () => {    const settingsService = getSettingsService()
    settingsService.clearSettingsResults()
    return { ok: true }
  })

  addMethod('settings.resetPricingToDefaults', async () => {    const settingsService = getSettingsService()
    settingsService.resetPricingToDefaults()
    return {
      ok: true,
      pricingConfig: settingsService.getPricingConfig(),
      defaultPricingConfig: settingsService.getDefaultPricingConfig(),
    }
  })

  addMethod(
    'settings.resetProviderPricing',
    async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter' }) => {
      const settingsService = getSettingsService()
    settingsService.resetProviderPricing(provider)
    return {
      ok: true,
      pricingConfig: settingsService.getPricingConfig(),
    }
  })

  addMethod('settings.setPricingForModel', async ({ provider, model, pricing }: { provider: string; model: string; pricing: any }) => {    const settingsService = getSettingsService()
    settingsService.setPricingForModel(provider, model, pricing)
    return {
      ok: true,
      pricingConfig: settingsService.getPricingConfig(),
    }
  })

  // Provider handlers
  addMethod(
    'provider.refreshModels',
    async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter' }) => {
      const providerService = getProviderService()
    await providerService.refreshModels(provider)
    const models = providerService.getModelsForProvider(provider)
    return { ok: true, models }
  })

  addMethod('provider.setDefaultModel', async ({ provider, model }: { provider: string; model: string }) => {    const providerService = getProviderService()
    providerService.setDefaultModel(provider, model)
    return { ok: true }
  })

  addMethod('provider.addFireworksModel', async ({ model }: { model: string }) => {
    const providerService = getProviderService()
    await providerService.addFireworksModel(model)
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  })

  addMethod('provider.removeFireworksModel', async ({ model }: { model: string }) => {
    const providerService = getProviderService()
    await providerService.removeFireworksModel(model)
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  })

  addMethod('provider.setSelectedProvider', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter' }) => {    const providerService = getProviderService()
    providerService.setSelectedProvider(provider)
    return {
      ok: true,
      selectedProvider: providerService.getSelectedProvider(),
      selectedModel: providerService.getSelectedModel(),
    }
  })

  addMethod('provider.setSelectedModel', async ({ model }: { model: string }) => {    const providerService = getProviderService()
    providerService.setSelectedModel(model)
    return { ok: true }
  })

  addMethod('provider.fireworks.loadDefaults', async () => {
    const providerService = getProviderService()
    await providerService.loadFireworksRecommendedDefaults()
    return {
      ok: true,
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      models: providerService.getModelsForProvider('fireworks'),
    }
  })

  addMethod('provider.addOpenRouterModel', async ({ model }: { model: string }) => {
    const providerService = getProviderService()
    await providerService.addOpenRouterModel(model)
    return {
      ok: true,
      openrouterAllowedModels: providerService.getOpenRouterAllowedModels(),
      models: providerService.getModelsForProvider('openrouter'),
    }
  })

  addMethod('provider.removeOpenRouterModel', async ({ model }: { model: string }) => {
    const providerService = getProviderService()
    await providerService.removeOpenRouterModel(model)
    return {
      ok: true,
      openrouterAllowedModels: providerService.getOpenRouterAllowedModels(),
      models: providerService.getModelsForProvider('openrouter'),
    }
  })

  addMethod('provider.openrouter.loadDefaults', async () => {
    const providerService = getProviderService()
    await providerService.loadOpenRouterRecommendedDefaults()
    return {
      ok: true,
      openrouterAllowedModels: providerService.getOpenRouterAllowedModels(),
      models: providerService.getModelsForProvider('openrouter'),
    }
  })
}
