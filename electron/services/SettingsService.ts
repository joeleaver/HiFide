/**
 * Settings Service
 * 
 * Manages application settings, API keys, and pricing configuration.
 */

import { Service } from './base/Service.js'
import type { ApiKeys, ModelPricing, PricingConfig, TokenUsage, TokenCost } from '../store/types.js'
import { DEFAULT_PRICING } from '../data/defaultPricing.js'
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
}

export class SettingsService extends Service<SettingsState> {
  constructor() {
    super(
      {
        settingsApiKeys: {
          openai: '',
          anthropic: '',
          gemini: '',
          fireworks: '',
          xai: '',
        },
        settingsSaving: false,
        settingsSaved: false,
        settingsSaveResult: null,
        settingsValidateResult: null,
        pricingConfig: DEFAULT_PRICING,
        defaultPricingConfig: DEFAULT_PRICING,
      },
      'settings'
    )

    // Force default pricing config to match the current codebase, ignoring any stale persistence
    this.state.defaultPricingConfig = DEFAULT_PRICING

    // Merge missing defaults into active pricing config (e.g. new models)
    this.mergeDefaultsIntoActivePricing()
  }

  private mergeDefaultsIntoActivePricing(): void {
    let changed = false
    const active = { ...this.state.pricingConfig }

    for (const provider of Object.keys(DEFAULT_PRICING)) {
      const defaultModels = DEFAULT_PRICING[provider as keyof PricingConfig]
      const activeModels = active[provider as keyof PricingConfig]

      // If provider missing in active, add it
      if (activeModels === undefined) {
        (active as any)[provider] = defaultModels
        changed = true
        continue
      }

      // If both are objects (model maps), merge missing models
      if (
        typeof activeModels === 'object' &&
        activeModels !== null &&
        typeof defaultModels === 'object' &&
        defaultModels !== null
      ) {
        for (const model of Object.keys(defaultModels)) {
          if (!(activeModels as any)[model]) {
            // New model found in defaults, add to active
            ;(activeModels as any)[model] = (defaultModels as any)[model]
            changed = true
          }
        }
      }
    }

    if (changed) {
      console.log('[SettingsService] Merged new default pricing models into active configuration')
      this.state.pricingConfig = active
      this.persistState()
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
        }
        const providerService = getProviderService()
        providerService.setProvidersValid(map)
        // Fetch models for newly valid providers (non-blocking)
        void providerService.refreshAllModels()

        // Clear startup banner if at least one provider is valid
        if (map.openai || map.anthropic || map.gemini || map.fireworks || map.xai) {
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
    this.setState({ pricingConfig: DEFAULT_PRICING })
  }

  resetProviderPricing(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'): void {
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

  calculateCost(provider: string, model: string, usage: TokenUsage): TokenCost | null {
    const config = this.state.pricingConfig[provider as keyof PricingConfig]

    if (typeof config === 'boolean') return null

    const pricing = (config as any)?.[model] as ModelPricing | undefined
    if (!pricing) return null

    return computeTokenCost(pricing, usage)
  }
}