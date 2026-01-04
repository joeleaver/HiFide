/**
 * Settings Service
 * 
 * Manages application settings, API keys, and pricing configuration.
 */

import { Service } from './base/Service.js'
import type { ApiKeys, ModelPricing, PricingConfig, TokenUsage, TokenCost } from '../store/types.js'
import { getDefaultPricingConfig } from '../data/defaultModelSettings.js'
import { getProviderService, getAppService } from './index.js'
import { computeTokenCost } from './settings-cost-utils.js'

interface SettingsState {
  settingsApiKeys: ApiKeys
  settingsSaving: boolean
  settingsSaved: boolean
  settingsSaveResult: { ok: boolean; failures: string[] } | null
  settingsValidateResult: { ok: boolean; failures: string[] } | null
  pricingConfig: PricingConfig
  defaultPricingConfig: PricingConfig
  vector: {
    enabled: boolean
    provider: 'local' | 'openai'
    model: string
    localModel: string
    codeModel?: string
    codeLocalModel?: string
    kbModel?: string
    kbLocalModel?: string
    memoriesModel?: string
    memoriesLocalModel?: string
  }
}

export class SettingsService extends Service<SettingsState> {
  constructor() {
    const DEFAULT_PRICING = getDefaultPricingConfig()
    super(
      {
        settingsApiKeys: {
          openai: '',
          anthropic: '',
          gemini: '',
          fireworks: '',
          xai: '',
          openrouter: '',
        },
        settingsSaving: false,
        settingsSaved: false,
        settingsSaveResult: null,
        settingsValidateResult: null,
        pricingConfig: DEFAULT_PRICING,
        defaultPricingConfig: DEFAULT_PRICING,
        vector: {
          enabled: true,
          provider: 'local',
          model: 'all-MiniLM-L6-v2 (Local)',
          localModel: 'Xenova/all-MiniLM-L6-v2',
          codeModel: 'all-MiniLM-L6-v2 (Local)',
          codeLocalModel: 'Xenova/all-MiniLM-L6-v2',
          kbModel: 'all-MiniLM-L6-v2 (Local)',
          kbLocalModel: 'Xenova/all-MiniLM-L6-v2',
          memoriesModel: 'all-MiniLM-L6-v2 (Local)',
          memoriesLocalModel: 'Xenova/all-MiniLM-L6-v2',
        },
      },
      'settings'
    )

    // Force default pricing config to match the current codebase, ignoring any stale persistence
    this.state.defaultPricingConfig = DEFAULT_PRICING

    // Enforce defaults as the single source of truth for the set of available models.
    // Pricing overrides are allowed ONLY for models present in DEFAULT_PRICING
    // (plus Fireworks user model overrides, which are handled by ProviderService).
    this.clampActivePricingToDefaults()
  }

  private clampActivePricingToDefaults(): void {
    const DEFAULT_PRICING = getDefaultPricingConfig()

    let changed = false
    const next: PricingConfig = { ...DEFAULT_PRICING }

    // Preserve the customRates flag from persisted state if present
    ;(next as any).customRates = !!(this.state.pricingConfig as any)?.customRates

    for (const provider of Object.keys(DEFAULT_PRICING)) {
      const defaultsForProvider = (DEFAULT_PRICING as any)[provider]
      if (typeof defaultsForProvider === 'boolean') {
        ;(next as any)[provider] = defaultsForProvider
        continue
      }

      const persistedForProvider = (this.state.pricingConfig as any)?.[provider]
      if (!persistedForProvider || typeof persistedForProvider !== 'object') {
        ;(next as any)[provider] = defaultsForProvider
        continue
      }

      // Special handling for providers that allow custom models (fireworks, openrouter)
      // Allow merging defaults with ALL persisted keys (user overrides + custom models)
      if (provider === 'fireworks' || provider === 'openrouter') {
        const merged: Record<string, ModelPricing> = { ...defaultsForProvider }
        // Copy all persisted keys, overwriting defaults if collision (user override)
        // and adding new keys (user custom models)
        for (const key of Object.keys(persistedForProvider)) {
          const val = persistedForProvider[key]
          if (val && typeof val === 'object') {
            merged[key] = val as ModelPricing
          }
        }
        
        // Detect if anything changed vs persisted
        // If merged differs from what we loaded, we need to mark as changed so we save the new state
        const mergedKeys = Object.keys(merged)
        const persistedKeys = persistedForProvider ? Object.keys(persistedForProvider) : []
        if (mergedKeys.length !== persistedKeys.length) {
          changed = true
        } else {
          for (const k of mergedKeys) {
            // If we have a key in merged that wasn't in persisted (e.g. new default), it changed
            if (!(k in persistedForProvider)) {
              changed = true
              break
            }
          }
        }
        
        ;(next as any)[provider] = merged
        // Skip the strict clamping loop below
        continue
      }

      // Only keep overrides for models that exist in defaults.
      const clampedProvider: Record<string, ModelPricing> = { ...defaultsForProvider }
      for (const model of Object.keys(defaultsForProvider)) {
        const persisted = persistedForProvider?.[model]
        if (persisted && typeof persisted === 'object') {
          clampedProvider[model] = persisted
        }
      }

      // Detect whether persisted had extra models (or missing providers)
      const persistedKeys = Object.keys(persistedForProvider)
      const defaultKeys = Object.keys(defaultsForProvider)
      if (persistedKeys.length !== defaultKeys.length) changed = true
      else {
        for (const k of persistedKeys) {
          if (!(k in defaultsForProvider)) {
            changed = true
            break
          }
        }
      }

      ;(next as any)[provider] = clampedProvider
    }

    // If provider set differs from defaults, also mark changed
    for (const provider of Object.keys(this.state.pricingConfig as any)) {
      if (!(provider in (DEFAULT_PRICING as any))) {
        changed = true
        break
      }
    }

    if (changed) {
      console.log('[SettingsService] Clamped persisted pricingConfig to defaults allowlist')
      this.state.pricingConfig = next
      this.persistState()
    } else {
      // Still ensure pricingConfig is at least defaults-shaped
      this.state.pricingConfig = next
    }
  }

  protected onStateChange(updates: Partial<SettingsState>): void {
    // Persist entire state to 'settings' key (matches persistKey in constructor)
    this.persistState()

    // Emit events
    if (updates.settingsApiKeys !== undefined) {
      this.events.emit('apiKeys:changed', this.state.settingsApiKeys)
    }

    if (updates.pricingConfig !== undefined || updates.defaultPricingConfig !== undefined) {
      this.events.emit('settings:pricing:changed', {
        pricingConfig: this.state.pricingConfig,
        defaultPricingConfig: this.state.defaultPricingConfig,
      })
    }
  }

  // Getters
  getApiKeys(): ApiKeys {
    return { ...this.state.settingsApiKeys }
  }

  getSaveResult(): { ok: boolean; failures: string[] } | null {
    return this.state.settingsSaveResult
  }

  getValidateResult(): { ok: boolean; failures: string[] } | null {
    return this.state.settingsValidateResult
  }

  getPricingConfig(): PricingConfig {
    return this.state.pricingConfig
  }

  getDefaultPricingConfig(): PricingConfig {
    return this.state.defaultPricingConfig
  }

  // API Key Setters
  setOpenAiApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        openai: value || '',
      },
      settingsSaved: false,
    })
  }

  setAnthropicApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        anthropic: value || '',
      },
      settingsSaved: false,
    })
  }

  setGeminiApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        gemini: value || '',
      },
      settingsSaved: false,
    })
  }

  setFireworksApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        fireworks: value || '',
      },
      settingsSaved: false,
    })
  }

  setXaiApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        xai: value || '',
      },
      settingsSaved: false,
    })
  }

  setOpenRouterApiKey(value: string): void {
    this.setState({
      settingsApiKeys: {
        ...this.state.settingsApiKeys,
        openrouter: value || '',
      },
      settingsSaved: false,
    })
  }

  // API Key Operations
  async loadSettingsApiKeys(): Promise<void> {
    // API keys are loaded from persistence automatically in constructor
    // This method is kept for compatibility
  }

  async saveSettingsApiKeys(): Promise<void> {
    this.setState({ settingsSaving: true, settingsSaved: false, settingsSaveResult: null })

    try {
      // Persistence happens automatically via onStateChange
      this.setState({
        settingsSaved: true,
        settingsSaving: false,
        settingsSaveResult: { ok: true, failures: [] },
      })
    } catch (e: any) {
      this.setState({
        settingsSaving: false,
        settingsSaveResult: { ok: false, failures: [`Unexpected error: ${e?.message || String(e)}`] },
      })
      console.error('[settings] Save error:', e)
    }
  }

  resetSettingsSaved(): void {
    this.setState({ settingsSaved: false })
  }

  clearSettingsResults(): void {
    this.setState({ settingsSaveResult: null, settingsValidateResult: null })
  }

  async validateApiKeys(): Promise<{ ok: boolean; failures: string[] }> {
    this.setState({ settingsValidateResult: null })

    try {
      const keys = this.state.settingsApiKeys

      // Timeout for each network call
      const FETCH_TIMEOUT_MS = 7000
      const fetchWithTimeout = async (url: string, options: any) => {
        const f: any = (globalThis as any).fetch
        if (!f) throw new Error('Fetch API unavailable')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
          return await f(url, { ...(options || {}), signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
      }

      // Run all provider validations in parallel
      const checks: Array<Promise<string | null>> = []

      if (keys.openai?.trim()) {
        checks.push(
          (async () => {
            try {
              const resp = await fetchWithTimeout('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: { Authorization: `Bearer ${keys.openai}` },
              })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `OpenAI: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `OpenAI: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      if (keys.anthropic?.trim()) {
        checks.push(
          (async () => {
            try {
              const resp = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
                method: 'GET',
                headers: {
                  'x-api-key': keys.anthropic,
                  'anthropic-version': '2023-06-01',
                },
              })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `Anthropic: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `Anthropic: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      if (keys.gemini?.trim()) {
        checks.push(
          (async () => {
            try {
              const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(keys.gemini)}`
              const resp = await fetchWithTimeout(url, { method: 'GET' })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `Gemini: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `Gemini: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      if (keys.fireworks?.trim()) {
        checks.push(
          (async () => {
            try {
              const resp = await fetchWithTimeout('https://api.fireworks.ai/inference/v1/models', {
                method: 'GET',
                headers: { Authorization: `Bearer ${keys.fireworks}` },
              })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `Fireworks: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `Fireworks: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      if (keys.xai?.trim()) {
        checks.push(
          (async () => {
            try {
              const resp = await fetchWithTimeout('https://api.x.ai/v1/models', {
                method: 'GET',
                headers: { Authorization: `Bearer ${keys.xai}` },
              })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `xAI: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `xAI: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      if (keys.openrouter?.trim()) {
        checks.push(
          (async () => {
            try {
              const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${keys.openrouter}`,
                  'HTTP-Referer': 'https://hifide.ai/',
                  'X-Title': 'Hifide AI',
                },
              })
              if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                return `OpenRouter: HTTP ${resp.status}: ${txt.slice(0, 100)}`
              }
            } catch (e: any) {
              return `OpenRouter: ${e?.message || String(e)}`
            }
            return null
          })()
        )
      }

      const results = await Promise.all(checks)
      const failures = results.filter((r): r is string => !!r)

      const result = failures.length > 0 ? { ok: false, failures } : { ok: true, failures: [] }

      console.log('[settings] validateApiKeys results', {
        ok: result.ok,
        failureCount: failures.length,
        failures,
        hasKeys: {
          openai: !!keys.openai?.trim(),
          anthropic: !!keys.anthropic?.trim(),
          gemini: !!keys.gemini?.trim(),
          fireworks: !!keys.fireworks?.trim(),
          xai: !!keys.xai?.trim(),
        },
      })

      // Update provider validity map and refresh models
      try {
        const lc = failures.map((f) => f.toLowerCase())
        const map: Record<string, boolean> = {
          openai: !!keys.openai?.trim() && !lc.some((f) => f.includes('openai')),
          anthropic: !!keys.anthropic?.trim() && !lc.some((f) => f.includes('anthropic')),
          gemini: !!keys.gemini?.trim() && !lc.some((f) => f.includes('gemini')),
          fireworks: !!keys.fireworks?.trim() && !lc.some((f) => f.includes('fireworks')),
          xai: !!keys.xai?.trim() && !lc.some((f) => f.includes('xai')),
          openrouter: !!keys.openrouter?.trim() && !lc.some((f) => f.includes('openrouter')),
        }
        const providerService = getProviderService()
        providerService.setProvidersValid(map)
        // Fetch models for newly valid providers (non-blocking)
        void providerService.refreshAllModels()

        // Clear startup banner if at least one provider is valid
        if (map.openai || map.anthropic || map.gemini || map.fireworks || map.xai || map.openrouter) {
          const appService = getAppService()
          if (appService?.setStartupMessage) {
            appService.setStartupMessage(null)
          }
        }
      } catch (e) {
        console.error('[settings] Error updating provider validity:', e)
      }

      this.setState({ settingsValidateResult: result })

      return result
    } catch (e: any) {
      const error = `Unexpected error: ${e?.message || String(e)}`
      console.error('[settings]', error)
      const result = { ok: false, failures: [error] }
      this.setState({ settingsValidateResult: result })
      return result
    }
  }

  // Pricing Actions
  setPricingForModel(provider: string, model: string, pricing: ModelPricing): void {
    const DEFAULT_PRICING = getDefaultPricingConfig() as any
    const defaultsForProvider = DEFAULT_PRICING?.[provider]
    const isAllowed =
      provider === 'fireworks' || provider === 'openrouter'
        ? true
        : !!(defaultsForProvider && typeof defaultsForProvider === 'object' && defaultsForProvider[model])

    if (!isAllowed) {
      console.warn('[SettingsService] Ignoring pricing override for non-default model', { provider, model })
      return
    }

    this.setState({
      pricingConfig: {
        ...this.state.pricingConfig,
        [provider]: {
          ...(this.state.pricingConfig[provider as keyof PricingConfig] as any),
          [model]: pricing,
        },
        customRates: true,
      },
    })
  }

  resetPricingToDefaults(): void {
    this.setState({ pricingConfig: getDefaultPricingConfig() })
  }

  resetProviderPricing(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter'): void {
    const DEFAULT_PRICING = getDefaultPricingConfig()
    const newConfig = {
      ...this.state.pricingConfig,
      [provider]: DEFAULT_PRICING[provider as keyof typeof DEFAULT_PRICING],
    }

    // Check if any provider still has custom rates
    const hasCustomRates = (['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const).some(
      (p) =>
        p !== provider && JSON.stringify((newConfig as any)[p]) !== JSON.stringify((DEFAULT_PRICING as any)[p])
    )

    this.setState({
      pricingConfig: {
        ...newConfig,
        customRates: hasCustomRates,
      },
    })
  }

  setVectorSettings(settings: Partial<SettingsState['vector']>): void {
    const nextVector = { ...this.state.vector, ...settings };
    
    const mapModel = (uiModel: string) => {
      if (uiModel.includes('all-MiniLM-L6-v2')) {
        return { provider: 'local', localModel: 'Xenova/all-MiniLM-L6-v2' };
      } else if (uiModel.includes('nomic')) {
        return { provider: 'local', localModel: 'nomic-ai/nomic-embed-text-v1.5' };
      } else if (uiModel.startsWith('text-embedding-3')) {
        return { provider: 'openai', localModel: this.state.vector.localModel };
      }
      return null;
    };

    // Map UI model names to backend paths
    if (settings.model) {
      const mapped = mapModel(settings.model);
      if (mapped) {
        nextVector.provider = mapped.provider as any;
        nextVector.localModel = mapped.localModel;
      }
    }

    if (settings.codeModel) {
      const mapped = mapModel(settings.codeModel);
      if (mapped) nextVector.codeLocalModel = mapped.localModel;
    }

    if (settings.kbModel) {
      const mapped = mapModel(settings.kbModel);
      if (mapped) nextVector.kbLocalModel = mapped.localModel;
    }

    if (settings.memoriesModel) {
      const mapped = mapModel(settings.memoriesModel);
      if (mapped) nextVector.memoriesLocalModel = mapped.localModel;
    }

    this.setState({ vector: nextVector });
  }

  calculateCost(provider: string, model: string, usage: TokenUsage): TokenCost | null {
    const config = this.state.pricingConfig[provider as keyof PricingConfig]

    if (typeof config === 'boolean') return null

    const pricing = (config as any)?.[model] as ModelPricing | undefined
    if (!pricing) return null

    return computeTokenCost(pricing, usage)
  }
}