/**
 * Provider Service
 * 
 * Manages LLM provider and model selection.
 */

import { Service } from './base/Service.js'
import type { ModelOption, RouteRecord } from '../store/types.js'
import { MAX_ROUTE_HISTORY } from '../../src/store/utils/constants'
import { getDefaultPricingConfig } from '../data/defaultModelSettings.js'
import { getSettingsService } from './index.js'

interface ProviderState {
  selectedModel: string
  selectedProvider: string
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ModelOption[]>
  defaultModels: Record<string, string>
  routeHistory: RouteRecord[]
  fireworksAllowedModels: string[]
  openrouterAllowedModels: string[]
}

export class ProviderService extends Service<ProviderState> {
  constructor() {

    super(
      {
        selectedModel: 'gpt-4o',
        selectedProvider: 'openai',
        providerValid: {
          openai: false,
          anthropic: false,
          gemini: false,
          fireworks: false,
          xai: false,
          openrouter: false,
        },
        modelsByProvider: {
          openai: [],
          anthropic: [],
          gemini: [],
          fireworks: [],
          xai: [],
          openrouter: [],
        },
        defaultModels: {},
        routeHistory: [],
        // NOTE: defaults are loaded from defaultModelSettings.json via getDefaultPricingConfig()
        // Users may still add their own Fireworks model overrides at runtime.
        fireworksAllowedModels: [],
        openrouterAllowedModels: [],
      },
      'provider'
    )


    // One-time migration: load from old individual keys if new key doesn't exist
    if (!this.persistence.has('provider')) {
      const oldModel = this.persistence.load<string>('selectedModel', 'gpt-4o')
      const oldProvider = this.persistence.load<string>('selectedProvider', 'openai')
      const oldDefaultModels = this.persistence.load<Record<string, string>>('defaultModels', {})
      const oldFireworksModels = this.persistence.load<string[]>('fireworksAllowedModels', [])
      const oldOpenRouterModels = this.persistence.load<string[]>('openrouterAllowedModels', [])

      if (
        oldModel !== 'gpt-4o' ||
        oldProvider !== 'openai' ||
        Object.keys(oldDefaultModels).length > 0 ||
        oldFireworksModels.length > 0 ||
        oldOpenRouterModels.length > 0
      ) {
        this.state = {
          ...this.state,
          selectedModel: oldModel,
          selectedProvider: oldProvider,
          defaultModels: oldDefaultModels,
          fireworksAllowedModels:
            oldFireworksModels.length > 0 ? oldFireworksModels : this.state.fireworksAllowedModels,
          openrouterAllowedModels:
            oldOpenRouterModels.length > 0 ? oldOpenRouterModels : this.state.openrouterAllowedModels,
        }
        // Save to new format
        this.persistState()
        // Clean up old keys
        this.persistence.delete('selectedModel')
        this.persistence.delete('selectedProvider')
        this.persistence.delete('autoRetry')
        this.persistence.delete('defaultModels')
        this.persistence.delete('fireworksAllowedModels')
        this.persistence.delete('openrouterAllowedModels')
      }
    }

    // Initialize Fireworks allowlist from defaultModelSettings.json (single source of truth).
    // If the user has previously customized the allowlist, the persisted state will already
    // contain values and we should preserve them.
    if (!this.state.fireworksAllowedModels || this.state.fireworksAllowedModels.length === 0) {
      const fwDefaults = Object.keys(getDefaultPricingConfig().fireworks || {})
      if (fwDefaults.length > 0) {
        this.state = {
          ...this.state,
          fireworksAllowedModels: fwDefaults,
        }
      }
    }

    // Initialize OpenRouter allowlist from defaultModelSettings.json (single source of truth).
    // If the user has previously customized the allowlist, the persisted state will already
    // contain values and we should preserve them.
    if (!this.state.openrouterAllowedModels || this.state.openrouterAllowedModels.length === 0) {
      const orDefaults = Object.keys(getDefaultPricingConfig().openrouter || {})
      if (orDefaults.length > 0) {
        this.state = {
          ...this.state,
          openrouterAllowedModels: orDefaults,
        }
      }
    }

    // Defensive clamp: if persisted state or some other code path populated large model lists,
    // ensure we only expose allowlisted defaults (plus Fireworks user overrides).
    this.ensureModelsByProviderAllowlist()
  }

  protected onStateChange(updates: Partial<ProviderState>): void {
    // Persist provider state (use persistState to save entire state to 'provider' key)
    if (
      updates.selectedModel !== undefined ||
      updates.selectedProvider !== undefined ||
      updates.defaultModels !== undefined ||
      updates.fireworksAllowedModels !== undefined ||
      updates.openrouterAllowedModels !== undefined
    ) {
      this.persistState()
    }

    // Emit events
    if (updates.selectedModel !== undefined || updates.selectedProvider !== undefined) {
      this.events.emit('provider:changed', {
        provider: this.state.selectedProvider,
        model: this.state.selectedModel,
      })
    }

    // Emit events when models or provider validity changes
    if (
      updates.modelsByProvider !== undefined ||
      updates.providerValid !== undefined ||
      updates.fireworksAllowedModels !== undefined ||
      updates.openrouterAllowedModels !== undefined ||
      updates.defaultModels !== undefined
    ) {
      this.events.emit('provider:models:changed', {
        providerValid: this.state.providerValid,
        modelsByProvider: this.state.modelsByProvider,
        fireworksAllowedModels: this.state.fireworksAllowedModels,
        openrouterAllowedModels: this.state.openrouterAllowedModels,
        defaultModels: this.state.defaultModels,
      })
    }
  }

  // Getters
  getSelectedModel(): string {
    return this.state.selectedModel
  }

  // Defensive clamp: prevent any non-default models from being exposed via modelsByProvider
  // (except Fireworks user overrides, which are controlled by fireworksAllowedModels).
  private ensureModelsByProviderAllowlist(): void {
    const nextModels: Record<string, ModelOption[]> = { ...this.state.modelsByProvider }
    const nextValid: Record<string, boolean> = { ...this.state.providerValid }
    let stateChanged = false

    const providers: Array<'openai' | 'anthropic' | 'gemini' | 'xai'> = ['openai', 'anthropic', 'gemini', 'xai']
    for (const p of providers) {
      nextModels[p] = this.filterToDefaults(p, Array.isArray(nextModels[p]) ? nextModels[p] : [])
    }

    const fwAllowed = new Set((this.state.fireworksAllowedModels || []).filter(Boolean))
    // For allowlist-based providers, the allowlist IS the source of truth for available models.
    // We rebuild the model list from the allowlist to ensure it's always in sync,
    // handling cases where modelsByProvider wasn't persisted or was cleared.
    nextModels.fireworks = Array.from(fwAllowed).map((id) => ({ value: id, label: id }))
    
    // If we have allowed models, the provider is implicitly valid (no network fetch needed to list)
    if (nextModels.fireworks.length > 0 && !nextValid.fireworks) {
      nextValid.fireworks = true
      stateChanged = true
    }

    const orAllowed = new Set((this.state.openrouterAllowedModels || []).filter(Boolean))
    nextModels.openrouter = Array.from(orAllowed).map((id) => ({ value: id, label: id }))
    
    // If we have allowed models, the provider is implicitly valid (no network fetch needed to list)
    if (nextModels.openrouter.length > 0 && !nextValid.openrouter) {
      nextValid.openrouter = true
      stateChanged = true
    }

    // Also check if models map actually changed (deep compare for other providers)
    if (!stateChanged) {
      try {
        if (JSON.stringify(this.state.modelsByProvider) !== JSON.stringify(nextModels)) {
          stateChanged = true
        }
      } catch {
        stateChanged = true
      }
    }

    if (stateChanged) {
      this.setState({ 
        modelsByProvider: nextModels,
        providerValid: nextValid
      })
    }
  }

  getSelectedProvider(): string {
    return this.state.selectedProvider
  }

  getProviderValid(provider: string): boolean {
    return this.state.providerValid[provider] || false
  }

  getModelsForProvider(provider: string): ModelOption[] {
    const raw = this.state.modelsByProvider[provider] || []

    // Always-on diagnostics to catch unexpected wide model lists at the source.
    // If we ever see non-default models here, it means some code path bypassed allowlisting.
    if (provider === 'openai') {
      try {
        const defaults = Object.keys(getDefaultPricingConfig().openai || {})
        const extra = raw.map((m) => m.value).filter((id) => !defaults.includes(id))
        if (extra.length > 0) {
          console.log('[ProviderService] openai models contained non-default entries', {
            count: raw.length,
            defaultCount: defaults.length,
            extra: extra.slice(0, 20),
          })
        }
      } catch (e) {
        console.warn('[ProviderService] diagnostics failed', e)
      }
    }

    return raw
  }

  getDefaultModel(provider: string): string | undefined {
    return this.state.defaultModels[provider]
  }

  getRouteHistory(): RouteRecord[] {
    return [...this.state.routeHistory]
  }

  getFireworksAllowedModels(): string[] {
    return [...this.state.fireworksAllowedModels]
  }

  getOpenRouterAllowedModels(): string[] {
    return [...this.state.openrouterAllowedModels]
  }

  // Setters
  setSelectedModel(model: string): void {
    this.setState({ selectedModel: model })
  }



  setSelectedProvider(provider: string): void {
    this.setState({ selectedProvider: provider })
  }

  setAutoRetry(_value: boolean): void {
    // Note: autoRetry property was removed from ProviderState but we keep the method
    // for compatibility or future use if needed, but currently it does nothing to state.
  }

  setProviderValid(provider: string, valid: boolean): void {
    this.setState({
      providerValid: {
        ...this.state.providerValid,
        [provider]: valid,
      },
    })
  }

  setProvidersValid(map: Record<string, boolean>): void {
    this.setState({ providerValid: map })
  }

  setModelsForProvider(provider: string, models: ModelOption[]): void {
    const nextMap = {
      ...this.state.modelsByProvider,
      [provider]: Array.isArray(models) ? models : [],
    }

    // Enforce allowlist at the setter boundary.
    if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini' || provider === 'xai') {
      nextMap[provider] = this.filterToDefaults(provider, nextMap[provider] || [])
    } else if (provider === 'fireworks') {
      const allowed = new Set((this.state.fireworksAllowedModels || []).filter(Boolean))
      nextMap.fireworks = (nextMap.fireworks || []).filter((m) => allowed.has(m.value))
    } else if (provider === 'openrouter') {
      const allowed = new Set((this.state.openrouterAllowedModels || []).filter(Boolean))
      nextMap.openrouter = (nextMap.openrouter || []).filter((m) => allowed.has(m.value))
    }

    this.setState({ modelsByProvider: nextMap })
  }

  setDefaultModel(provider: string, model: string): void {
    this.setState({
      defaultModels: {
        ...this.state.defaultModels,
        [provider]: model,
      },
    })
  }

  pushRouteRecord(record: RouteRecord): void {
    const updated = [record, ...this.state.routeHistory].slice(0, MAX_ROUTE_HISTORY)
    this.setState({ routeHistory: updated })
  }

  ensureProviderModelConsistency(): void {
    const validMap = this.state.providerValid || {}
    const anyValidated = Object.values(validMap).some(Boolean)

    // Get list of valid providers, or all providers if none are validated yet
    const providerOptions = anyValidated
      ? (['openai', 'anthropic', 'gemini', 'fireworks', 'xai', 'openrouter'] as const).filter((p) => validMap[p])
      : (['openai', 'anthropic', 'gemini', 'fireworks', 'xai', 'openrouter'] as const)

    let provider = this.state.selectedProvider

    // If current provider is not in the valid list, switch to first valid provider
    if (!providerOptions.includes(provider as any) && providerOptions.length > 0) {
      provider = providerOptions[0]
      this.setState({ selectedProvider: provider })
    }

    // Get models for current provider
    const models = this.state.modelsByProvider[provider] || []

    // Check if current model is valid for this provider
    const currentModelValid = models.some((m) => m.value === this.state.selectedModel)

    // Only auto-select a model if the current one is invalid
    if (!currentModelValid && models.length > 0) {
      // Check if we have a preferred default model for this provider
      const preferred = this.state.defaultModels?.[provider]
      const hasPreferred = preferred && models.some((m) => m.value === preferred)

      if (hasPreferred) {
        // Use preferred model if it's available
        this.setState({ selectedModel: preferred })
      } else {
        // Otherwise use first available model
        const first = models[0]
        this.setState({ selectedModel: first.value })
      }
    }
  }

  // Fireworks allowlist
  async setFireworksAllowedModels(models: string[]): Promise<void> {
    this.setState({ fireworksAllowedModels: models })
    this.ensureModelsByProviderAllowlist()
    await this.refreshFireworksModelsSafely()
  }

  async addFireworksModel(model: string): Promise<void> {
    const trimmed = model.trim()
    if (!trimmed) return
    const current = this.state.fireworksAllowedModels
    if (!current.includes(trimmed)) {
      this.setState({ fireworksAllowedModels: [...current, trimmed] })
      this.ensureModelsByProviderAllowlist()
      await this.refreshFireworksModelsSafely()
    }
  }

  async removeFireworksModel(model: string): Promise<void> {
    this.setState({
      fireworksAllowedModels: this.state.fireworksAllowedModels.filter((m) => m !== model),
    })
    this.ensureModelsByProviderAllowlist()
    await this.refreshFireworksModelsSafely()
  }

  async loadFireworksRecommendedDefaults(): Promise<void> {
    const fwDefaults = Object.keys(getDefaultPricingConfig().fireworks || {})
    if (fwDefaults.length > 0) {
      await this.setFireworksAllowedModels(fwDefaults)
    }
  }

  // OpenRouter allowlist
  async setOpenRouterAllowedModels(models: string[]): Promise<void> {
    this.setState({ openrouterAllowedModels: models })
    await this.refreshOpenRouterModelsSafely()
  }

  async addOpenRouterModel(model: string): Promise<void> {
    const current = new Set(this.state.openrouterAllowedModels || [])
    if (!current.has(model)) {
      current.add(model)
      this.setState({ openrouterAllowedModels: Array.from(current) })
      await this.refreshOpenRouterModelsSafely()
    }
  }

  async removeOpenRouterModel(model: string): Promise<void> {
    const current = (this.state.openrouterAllowedModels || []).filter((m) => m !== model)
    this.setState({ openrouterAllowedModels: current })
    await this.refreshOpenRouterModelsSafely()
  }

  async loadOpenRouterRecommendedDefaults(): Promise<void> {
    const orDefaults = Object.keys(getDefaultPricingConfig().openrouter || {})
    if (orDefaults.length > 0) {
      await this.setOpenRouterAllowedModels(orDefaults)
    }
  }

  private async refreshOpenRouterModelsSafely(): Promise<void> {
    try {
      await this.refreshModels('openrouter')
    } catch (e) {
      console.warn('[provider] refresh openrouter failed', e)
    }
    this.ensureProviderModelConsistency()
  }

  private async refreshFireworksModelsSafely(): Promise<void> {
    try {
      await this.refreshModels('fireworks')
    } catch (e) {
      console.warn('[provider] refresh fireworks failed', e)
    }
    this.ensureProviderModelConsistency()
  }

  // Async operations
  async refreshModels(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter'): Promise<void> {
    try {
      // Get API key from settings service
      const settingsService = getSettingsService()
      const keys = settingsService.getApiKeys() || {}

      let key: string | null = null
      if (provider === 'openai') key = (keys.openai || '').trim()
      else if (provider === 'anthropic') key = (keys.anthropic || '').trim()
      else if (provider === 'gemini') key = (keys.gemini || '').trim()
      else if (provider === 'fireworks') key = (keys.fireworks || '').trim()
      else if (provider === 'xai') key = (keys.xai || '').trim()
      else if (provider === 'openrouter') key = (keys.openrouter || '').trim()

      // Fallback to environment variables
      if (!key) {
        if (provider === 'openai' && process.env.OPENAI_API_KEY) key = process.env.OPENAI_API_KEY.trim()
        else if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY)
          key = process.env.ANTHROPIC_API_KEY.trim()
        else if (provider === 'gemini' && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))
          key = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim()
        else if (provider === 'fireworks' && process.env.FIREWORKS_API_KEY)
          key = process.env.FIREWORKS_API_KEY.trim()
        else if (provider === 'xai' && process.env.XAI_API_KEY) key = process.env.XAI_API_KEY.trim()
        else if (provider === 'openrouter' && process.env.OPENROUTER_API_KEY) key = process.env.OPENROUTER_API_KEY.trim()
      }

      if (!key) {
        // Fallback to defaults if no key available
        let fallbackList: ModelOption[] = []

        if (provider === 'openrouter') {
          // For OpenRouter, use the persisted allowlist instead of hardcoded defaults
          const allowed = this.state.openrouterAllowedModels || []
          fallbackList = allowed.map((id) => ({ value: id, label: id }))
        } else if (provider === 'fireworks') {
          // For Fireworks, use the persisted allowlist instead of hardcoded defaults
          const allowed = this.state.fireworksAllowedModels || []
          fallbackList = allowed.map((id) => ({ value: id, label: id }))
        } else {
          // Source of truth: pricing allowlist in defaultModelSettings.json
          // (NOT modelDefaults; modelDefaults may contain legacy entries).
          const defaults = getDefaultPricingConfig()[provider] || {}
          fallbackList = Object.keys(defaults).map((id) => ({ value: id, label: id }))
        }

        // IMPORTANT: Always go through setModelsForProvider so allowlisting is enforced
        // consistently (single source of truth: defaultModelSettings.json).
        this.setModelsForProvider(provider, fallbackList)
        return
      }

      let list: ModelOption[] = []

      if (provider === 'openai') {
        list = this.filterToDefaults('openai', await this.fetchOpenAIModels(key))
      } else if (provider === 'anthropic') {
        list = this.filterToDefaults('anthropic', await this.fetchAnthropicModels(key))
      } else if (provider === 'gemini') {
        list = this.filterToDefaults('gemini', await this.fetchGeminiModels(key))
      } else if (provider === 'fireworks') {
        list = await this.fetchFireworksModels()
      } else if (provider === 'xai') {
        list = this.filterToDefaults('xai', await this.fetchXAIModels(key))
      } else if (provider === 'openrouter') {
        list = await this.fetchOpenRouterModels(key)
      }

      // IMPORTANT: Always go through setModelsForProvider so allowlisting is enforced
      // consistently (single source of truth: defaultModelSettings.json).
      this.setModelsForProvider(provider, list)

      this.setProviderValid(provider, true)

      // Auto-select first model as default if no default is set OR if current default is not in the list
      const currentDefault = this.state.defaultModels?.[provider]
      const isCurrentDefaultValid = currentDefault && list.some((m) => m.value === currentDefault)

      if (list.length > 0 && !isCurrentDefaultValid) {
        const firstModel = list[0].value
        this.setDefaultModel(provider, firstModel)
      }
    } catch (e) {
      console.error('[provider] Failed to refresh models for', provider, ':', e)

      this.setProviderValid(provider, false)

      // Fallback to defaults on error
      let fallbackList: ModelOption[] = []

      if (provider === 'openrouter') {
        const allowed = this.state.openrouterAllowedModels || []
        fallbackList = allowed.map((id) => ({ value: id, label: id }))
      } else if (provider === 'fireworks') {
        const allowed = this.state.fireworksAllowedModels || []
        fallbackList = allowed.map((id) => ({ value: id, label: id }))
      } else {
        const defaults = getDefaultPricingConfig()[provider] || {}
        fallbackList = Object.keys(defaults).map((id) => ({ value: id, label: id }))
      }

      // IMPORTANT: Always go through setModelsForProvider so allowlisting is enforced
      // consistently (single source of truth: defaultModelSettings.json).
      this.setModelsForProvider(provider, fallbackList)
    }
  }

  async refreshAllModels(): Promise<void> {
    const providers: Array<'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter'> = [
      'openai',
      'anthropic',
      'gemini',
      'fireworks',
      'xai',
      'openrouter',
    ]

    for (const provider of providers) {
      try {
        await this.refreshModels(provider)
      } catch (e) {
        console.error('[provider] Failed to refresh models for', provider, ':', e)
      }
    }
  }

  /**
   * Filter a fetched provider model list to the allowlisted models in defaultModelSettings.json.
   *
   * The pricing config (getDefaultPricingConfig) is treated as the single source of truth for
   * which *default* models exist in the app.
   */
  private filterToDefaults(
    provider: 'openai' | 'anthropic' | 'gemini' | 'xai',
    fetched: ModelOption[]
  ): ModelOption[] {
    const defaults = getDefaultPricingConfig()[provider] || {}
    const allowed = new Set(Object.keys(defaults))
    if (allowed.size === 0) return []
    return (Array.isArray(fetched) ? fetched : []).filter((m) => allowed.has(m.value))
  }

  // Private helper methods for fetching models
  private async fetchOpenAIModels(key: string): Promise<ModelOption[]> {
    const f: any = (globalThis as any).fetch
    if (!f) throw new Error('Fetch API unavailable')

    const resp = await f('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const data = await resp.json()
    const ids: string[] = (Array.isArray((data as any)?.data) ? (data as any).data : [])
      .map((m: any) => m?.id)
      .filter((id: any) => typeof id === 'string')

    // IMPORTANT: model allowlisting is enforced by defaultModelSettings.json.
    // Do not apply additional heuristics here; just return the provider's list
    // (downstream will clamp via filterToDefaults / setModelsForProvider).
    const uniq = Array.from(new Set(ids))
    return uniq.map((id) => ({ value: id, label: id }))
  }

  private async fetchAnthropicModels(key: string): Promise<ModelOption[]> {
    const f: any = (globalThis as any).fetch
    if (!f) throw new Error('Fetch API unavailable')

    const resp = await f('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const data = await resp.json()
    const arr = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
    const ids: string[] = arr.map((m: any) => m?.id || m?.name).filter(Boolean)
    const uniq = Array.from(new Set(ids))

    return uniq.map((id) => ({ value: id, label: id }))
  }

  private async fetchGeminiModels(key: string): Promise<ModelOption[]> {
    const f: any = (globalThis as any).fetch
    if (!f) throw new Error('Fetch API unavailable')

    const base = 'https://generativelanguage.googleapis.com'
    const urls = [
      `${base}/v1beta/models?key=${encodeURIComponent(key)}`,
      `${base}/v1/models?key=${encodeURIComponent(key)}`,
    ]

    const all: any[] = []
    for (const url of urls) {
      try {
        const resp = await f(url)
        if (resp.ok) {
          const data = await resp.json()
          const arr = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : []
          if (Array.isArray(arr)) all.push(...arr)
        }
      } catch {}
    }

    // Normalize and dedupe. Do not apply additional filtering; allowlisting is enforced
    // by defaultModelSettings.json via filterToDefaults / setModelsForProvider.
    const seen = new Set<string>()
    const models = all
      .map((m: any) => {
        const full = (m?.name || m?.model || '').toString()
        const id = full.startsWith('models/') ? full.split('/').pop() : full
        const supported: string[] = m?.supportedGenerationMethods || m?.supported_generation_methods || []
        return { id, label: id, supported }
      })
      .filter((m: any) => {
        const id = m.id || ''

        if (seen.has(id)) return false
        seen.add(id)
        return true
      })

    return models.map((m: any) => ({ value: m.id, label: m.label }))
  }

  private async fetchFireworksModels(): Promise<ModelOption[]> {
    // Fireworks uses an allowlist from settings
    const fwAllowed = this.state.fireworksAllowedModels || []
    const uniq = Array.from(new Set(fwAllowed.filter(Boolean)))
    return uniq.map((id) => ({ value: id, label: id }))
  }

  private async fetchXAIModels(key: string): Promise<ModelOption[]> {
    const f: any = (globalThis as any).fetch
    if (!f) throw new Error('Fetch API unavailable')

    const resp = await f('https://api.x.ai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const data = await resp.json()
    const arr = Array.isArray(data?.data) ? data.data : []
    const ids: string[] = arr.map((m: any) => m?.id || m?.name).filter(Boolean)
    // IMPORTANT: model allowlisting is enforced by defaultModelSettings.json.
    // Do not apply additional heuristics here; just return the provider's list
    // (downstream will clamp via filterToDefaults / setModelsForProvider).
    const uniq = Array.from(new Set(ids))
    return uniq.map((id) => ({ value: id, label: id }))
  }

  private async fetchOpenRouterModels(_key: string): Promise<ModelOption[]> {
    // OpenRouter uses an allowlist from settings (similar to Fireworks)
    const orAllowed = this.state.openrouterAllowedModels || []
    const uniq = Array.from(new Set(orAllowed.filter(Boolean)))
    return uniq.map((id) => ({ value: id, label: id }))
  }
}

