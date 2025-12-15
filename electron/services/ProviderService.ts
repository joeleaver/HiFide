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
  autoRetry: boolean
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ModelOption[]>
  defaultModels: Record<string, string>
  routeHistory: RouteRecord[]
  fireworksAllowedModels: string[]
}

export class ProviderService extends Service<ProviderState> {
  constructor() {

    super(
      {
        selectedModel: 'gpt-4o',
        selectedProvider: 'openai',
        autoRetry: false,
        providerValid: {
          openai: false,
          anthropic: false,
          gemini: false,
          fireworks: false,
          xai: false,
        },
        modelsByProvider: {
          openai: [],
          anthropic: [],
          gemini: [],
          fireworks: [],
          xai: [],
        },
        defaultModels: {},
        routeHistory: [],
        fireworksAllowedModels: [
          'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
          'accounts/fireworks/models/glm-4p6',
          'accounts/fireworks/models/kimi-k2-instruct-0905',
          'accounts/fireworks/models/deepseek-v3p1-terminus',
	          'accounts/fireworks/models/deepseek-v3p2',
          'accounts/fireworks/models/kimi-k2-thinking',
          'accounts/fireworks/models/minimax-m2',
        ],
      },
      'provider'
    )

    // One-time migration: load from old individual keys if new key doesn't exist
    if (!this.persistence.has('provider')) {
      const oldModel = this.persistence.load<string>('selectedModel', 'gpt-4o')
      const oldProvider = this.persistence.load<string>('selectedProvider', 'openai')
      const oldAutoRetry = this.persistence.load<boolean>('autoRetry', false)
      const oldDefaultModels = this.persistence.load<Record<string, string>>('defaultModels', {})
      const oldFireworksModels = this.persistence.load<string[]>('fireworksAllowedModels', [])

      if (
        oldModel !== 'gpt-4o' ||
        oldProvider !== 'openai' ||
        oldAutoRetry !== false ||
        Object.keys(oldDefaultModels).length > 0 ||
        oldFireworksModels.length > 0
      ) {
        this.state = {
          ...this.state,
          selectedModel: oldModel,
          selectedProvider: oldProvider,
          autoRetry: oldAutoRetry,
          defaultModels: oldDefaultModels,
          fireworksAllowedModels:
            oldFireworksModels.length > 0 ? oldFireworksModels : this.state.fireworksAllowedModels,
        }
        // Save to new format
        this.persistState()
        // Clean up old keys
        this.persistence.delete('selectedModel')
        this.persistence.delete('selectedProvider')
        this.persistence.delete('autoRetry')
        this.persistence.delete('defaultModels')
        this.persistence.delete('fireworksAllowedModels')
      }
    }
  }

  protected onStateChange(updates: Partial<ProviderState>): void {
    // Persist provider state (use persistState to save entire state to 'provider' key)
    if (
      updates.selectedModel !== undefined ||
      updates.selectedProvider !== undefined ||
      updates.autoRetry !== undefined ||
      updates.defaultModels !== undefined ||
      updates.fireworksAllowedModels !== undefined
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
      updates.defaultModels !== undefined
    ) {
      this.events.emit('provider:models:changed', {
        providerValid: this.state.providerValid,
        modelsByProvider: this.state.modelsByProvider,
        fireworksAllowedModels: this.state.fireworksAllowedModels,
        defaultModels: this.state.defaultModels,
      })
    }
  }

  // Getters
  getSelectedModel(): string {
    return this.state.selectedModel
  }

  getSelectedProvider(): string {
    return this.state.selectedProvider
  }

  getAutoRetry(): boolean {
    return this.state.autoRetry
  }

  getProviderValid(provider: string): boolean {
    return this.state.providerValid[provider] || false
  }

  getModelsForProvider(provider: string): ModelOption[] {
    return this.state.modelsByProvider[provider] || []
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

  // Setters
  setSelectedModel(model: string): void {
    this.setState({ selectedModel: model })
    // Note: Session provider/model is set explicitly via setSessionProviderModelFor(), not auto-synced
  }

  setSelectedProvider(provider: string): void {
    this.setState({ selectedProvider: provider })

    // Immediately update model to match new provider
    const models = this.state.modelsByProvider[provider] || []

    // Check if we have a preferred default model for this provider
    const preferred = this.state.defaultModels?.[provider]
    const hasPreferred = preferred && models.some((m) => m.value === preferred)

    if (hasPreferred) {
      // Use preferred model if it's available
      this.setState({ selectedModel: preferred })
    } else if (models.length > 0) {
      // Otherwise use first available model
      const first = models[0]
      this.setState({ selectedModel: first.value })
    }

    // Note: Session provider/model is set explicitly via setSessionProviderModelFor(), not auto-synced
  }

  setAutoRetry(value: boolean): void {
    this.setState({ autoRetry: value })
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
    this.setState({
      modelsByProvider: {
        ...this.state.modelsByProvider,
        [provider]: models,
      },
    })
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
      ? (['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const).filter((p) => validMap[p])
      : (['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const)

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
    await this.refreshFireworksModelsSafely()
  }

  async addFireworksModel(model: string): Promise<void> {
    const trimmed = model.trim()
    if (!trimmed) return
    const current = this.state.fireworksAllowedModels
    if (!current.includes(trimmed)) {
      this.setState({ fireworksAllowedModels: [...current, trimmed] })
      await this.refreshFireworksModelsSafely()
    }
  }

  async removeFireworksModel(model: string): Promise<void> {
    this.setState({
      fireworksAllowedModels: this.state.fireworksAllowedModels.filter((m) => m !== model),
    })
    await this.refreshFireworksModelsSafely()
  }

  async loadFireworksRecommendedDefaults(): Promise<void> {
    const defaults = [
      'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
      'accounts/fireworks/models/glm-4p6',
      'accounts/fireworks/models/kimi-k2-instruct-0905',
      'accounts/fireworks/models/deepseek-v3p1-terminus',
	      'accounts/fireworks/models/deepseek-v3p2',
      'accounts/fireworks/models/kimi-k2-thinking',
      'accounts/fireworks/models/minimax-m2',
    ]
    this.setState({ fireworksAllowedModels: defaults })
    await this.refreshFireworksModelsSafely()
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
  async refreshModels(provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'): Promise<void> {
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
      }

      if (!key) {
        // Fallback to defaults if no key available
        const defaults = getDefaultPricingConfig()[provider] || {}
        const fallbackList = Object.keys(defaults).map((id) => ({ value: id, label: id }))

        this.setState({
          modelsByProvider: {
            ...this.state.modelsByProvider,
            [provider]: fallbackList,
          },
        })
        return
      }

      let list: ModelOption[] = []

      if (provider === 'openai') {
        list = await this.fetchOpenAIModels(key)
      } else if (provider === 'anthropic') {
        list = await this.fetchAnthropicModels(key)
      } else if (provider === 'gemini') {
        list = await this.fetchGeminiModels(key)
      } else if (provider === 'fireworks') {
        list = await this.fetchFireworksModels()
      } else if (provider === 'xai') {
        list = await this.fetchXAIModels(key)
      }

      this.setState({
        modelsByProvider: {
          ...this.state.modelsByProvider,
          [provider]: list,
        },
      })

      // Auto-select first model as default if no default is set OR if current default is not in the list
      const currentDefault = this.state.defaultModels?.[provider]
      const isCurrentDefaultValid = currentDefault && list.some((m) => m.value === currentDefault)

      if (list.length > 0 && !isCurrentDefaultValid) {
        const firstModel = list[0].value
        this.setDefaultModel(provider, firstModel)
      }
    } catch (e) {
      console.error('[provider] Failed to refresh models for', provider, ':', e)

      // Fallback to defaults on error
      const defaults = getDefaultPricingConfig()[provider] || {}
      const fallbackList = Object.keys(defaults).map((id) => ({ value: id, label: id }))

      this.setState({
        modelsByProvider: {
          ...this.state.modelsByProvider,
          [provider]: fallbackList,
        },
      })
    }
  }

  async refreshAllModels(): Promise<void> {
    const providers: Array<'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'> = [
      'openai',
      'anthropic',
      'gemini',
      'fireworks',
      'xai',
    ]

    for (const provider of providers) {
      try {
        await this.refreshModels(provider)
      } catch (e) {
        console.error('[provider] Failed to refresh models for', provider, ':', e)
      }
    }
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

    const allowed = ids.filter(
      (id) =>
        /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/i.test(id) &&
        !/realtime/i.test(id) &&
        !/(whisper|audio|tts|speech|embedding|embeddings)/i.test(id)
    )
    const uniq = Array.from(new Set(allowed))

    const allowPriority = ['gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4', 'o4-mini', 'o3-mini']
    const withLabels = uniq.map((id) => ({ id, label: id }))
    withLabels.sort((a, b) => {
      const ia = allowPriority.findIndex((p) => a.id.startsWith(p))
      const ib = allowPriority.findIndex((p) => b.id.startsWith(p))
      if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      return a.id.localeCompare(b.id)
    })

    return withLabels.map((m) => ({ value: m.id, label: m.label }))
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

    // Normalize, filter and dedupe
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
        const hasGenerate = m.supported?.includes('generateContent')
        const isNotEmbedding = !/(embedding|vision)/i.test(id)
        const isNotImageGen = !/image-generation/i.test(id)
        if (!(hasGenerate && isNotEmbedding && isNotImageGen)) return false
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
    const allowed = ids.filter((id) => /^grok-4/i.test(id) || id === 'grok-code-fast-1')
    const uniq = Array.from(new Set(allowed))

    return uniq.map((id) => ({ value: id, label: id }))
  }
}

