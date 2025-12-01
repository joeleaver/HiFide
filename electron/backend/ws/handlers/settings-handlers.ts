/**
 * Settings and Provider RPC handlers
 */

import type { ModelOption } from '../../../store/types.js'
import { getSettingsService, getProviderService } from '../../../services/index.js'

/**
 * Create settings and provider RPC handlers
 */
export function createSettingsHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void
) {
  // Settings handlers
  addMethod('settings.get', async () => {
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
      settingsSaving: false,
      settingsSaved: false,
      providerValid,
      modelsByProvider,
      defaultModels,
      selectedProvider: providerService.getSelectedProvider(),
      selectedModel: providerService.getSelectedModel(),
      autoRetry: providerService.getAutoRetry(),
      fireworksAllowedModels: providerService.getFireworksAllowedModels(),
      startupMessage: null, // AppService handles this
      pricingConfig: settingsService.getPricingConfig(),
      defaultPricingConfig: settingsService.getDefaultPricingConfig(),
    }
  })

  addMethod('settings.setApiKeys', async ({ apiKeys }: { apiKeys: Partial<any> }) => {    const settingsService = getSettingsService()
    
    if (apiKeys.openai !== undefined) settingsService.setOpenAiApiKey(apiKeys.openai)
    if (apiKeys.anthropic !== undefined) settingsService.setAnthropicApiKey(apiKeys.anthropic)
    if (apiKeys.gemini !== undefined) settingsService.setGeminiApiKey(apiKeys.gemini)
    if (apiKeys.fireworks !== undefined) settingsService.setFireworksApiKey(apiKeys.fireworks)
    if (apiKeys.xai !== undefined) settingsService.setXaiApiKey(apiKeys.xai)
    
    return { ok: true }
  })

  addMethod('settings.saveKeys', async () => {
    // Keys are saved automatically by SettingsService
    return { ok: true }
  })

  addMethod('settings.validateKeys', async () => {    const settingsService = getSettingsService()
    const providerService = getProviderService()

    // Actually trigger validation instead of just returning cached result
    const result = await settingsService.validateApiKeys()

    // Update provider valid states based on validation result
    if (result.ok && result.failures.length === 0) {
      // All providers validated successfully
      const keys = settingsService.getApiKeys()
      providerService.setProviderValid('openai', !!keys.openai?.trim())
      providerService.setProviderValid('anthropic', !!keys.anthropic?.trim())
      providerService.setProviderValid('gemini', !!keys.gemini?.trim())
      providerService.setProviderValid('fireworks', !!keys.fireworks?.trim())
      providerService.setProviderValid('xai', !!keys.xai?.trim())
    } else {
      // Some providers failed - update based on failures
      const keys = settingsService.getApiKeys()
      const failures = result.failures || []
      providerService.setProviderValid('openai', !!keys.openai?.trim() && !failures.some((f: string) => f.toLowerCase().includes('openai')))
      providerService.setProviderValid('anthropic', !!keys.anthropic?.trim() && !failures.some((f: string) => f.toLowerCase().includes('anthropic')))
      providerService.setProviderValid('gemini', !!keys.gemini?.trim() && !failures.some((f: string) => f.toLowerCase().includes('gemini')))
      providerService.setProviderValid('fireworks', !!keys.fireworks?.trim() && !failures.some((f: string) => f.toLowerCase().includes('fireworks')))
      providerService.setProviderValid('xai', !!keys.xai?.trim() && !failures.some((f: string) => f.toLowerCase().includes('xai')))
    }

    return result
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

  addMethod('settings.resetProviderPricing', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {    const settingsService = getSettingsService()
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
  addMethod('provider.refreshModels', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {    const providerService = getProviderService()
    await providerService.refreshModels(provider)
    const models = providerService.getModelsForProvider(provider)
    return { ok: true, models }
  })

  addMethod('provider.setDefaultModel', async ({ provider, model }: { provider: string; model: string }) => {    const providerService = getProviderService()
    providerService.setDefaultModel(provider, model)
    return { ok: true }
  })

  addMethod('provider.setAutoRetry', async ({ value }: { value: boolean }) => {    const providerService = getProviderService()
    providerService.setAutoRetry(value)
    return { ok: true }
  })

  addMethod('provider.addFireworksModel', async ({ model }: { model: string }) => {    const providerService = getProviderService()
    providerService.addFireworksModel(model)
    return { ok: true }
  })

  addMethod('provider.removeFireworksModel', async ({ model }: { model: string }) => {    const providerService = getProviderService()
    providerService.removeFireworksModel(model)
    return { ok: true }
  })

  addMethod('provider.setSelectedProvider', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {    const providerService = getProviderService()
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
    // This method was removed - Fireworks defaults are now set in ProviderService constructor
    return { ok: true }
  })
}
