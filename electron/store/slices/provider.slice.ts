/**
 * Provider Slice
 * 
 * Manages LLM provider and model selection.
 * 
 * Responsibilities:
 * - Track selected provider and model
 * - Manage provider validation state
 * - Load and cache available models per provider
 * - Handle default models per provider
 * - Track route history for auto-routing
 * - Ensure provider/model consistency
 * 
 * Dependencies:
 * - None (relatively independent)
 */

import type { StateCreator } from 'zustand'
import type { ModelOption, RouteRecord } from '../types'
import { MAX_ROUTE_HISTORY } from '../utils/constants'
import { getProviderKey } from '../../core/state'

// ============================================================================
// Types
// ============================================================================

export interface ProviderSlice {
  // State
  selectedModel: string
  selectedProvider: string
  autoRetry: boolean
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ModelOption[]>
  defaultModels: Record<string, string>
  routeHistory: RouteRecord[]
  
  // Actions
  setSelectedModel: (model: string) => void
  setSelectedProvider: (provider: string) => void
  setAutoRetry: (value: boolean) => void
  setProviderValid: (params: { provider: string; valid: boolean }) => void
  setProvidersValid: (map: Record<string, boolean>) => void
  setModelsForProvider: (params: { provider: string; models: ModelOption[] }) => void
  refreshModels: (provider: 'openai' | 'anthropic' | 'gemini') => Promise<void>
  refreshAllModels: () => Promise<void>
  setDefaultModel: (params: { provider: string; model: string }) => void
  pushRouteRecord: (record: RouteRecord) => void
  ensureProviderModelConsistency: () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createProviderSlice: StateCreator<ProviderSlice, [], [], ProviderSlice> = (set, get) => ({
  // State - Initialized with defaults, persist middleware will restore saved values
  selectedModel: 'gpt-4o',
  selectedProvider: 'openai',
  autoRetry: false,
  providerValid: {
    openai: false,
    anthropic: false,
    gemini: false,
  },
  modelsByProvider: {
    openai: [],
    anthropic: [],
    gemini: [],
  },
  defaultModels: {},
  routeHistory: [],
  
  // Actions
  setSelectedModel: (model: string) => {
    set({ selectedModel: model })
  },

  setSelectedProvider: (provider: string) => {
    set({ selectedProvider: provider })

    // Immediately update model to match new provider
    const state = get()
    const models = state.modelsByProvider[provider] || []

    // Check if we have a preferred default model for this provider
    const preferred = state.defaultModels?.[provider]
    const hasPreferred = preferred && models.some((m) => m.value === preferred)

    if (hasPreferred) {
      // Use preferred model if it's available
      set({ selectedModel: preferred })
    } else if (models.length > 0) {
      // Otherwise use first available model
      const first = models[0]
      set({ selectedModel: first.value })
    }
  },

  setAutoRetry: (value: boolean) => {
    set({ autoRetry: value })
  },
  
  setProviderValid: ({ provider, valid }: { provider: string; valid: boolean }) => {
    set((state) => ({
      providerValid: {
        ...state.providerValid,
        [provider]: valid,
      },
    }))
  },
  
  setProvidersValid: (map: Record<string, boolean>) => {
    set((state) => ({
      providerValid: {
        ...state.providerValid,
        ...map,
      },
    }))

    // Ensure consistency after provider validation changes
    get().ensureProviderModelConsistency()
  },
  
  setModelsForProvider: ({ provider, models }: { provider: string; models: ModelOption[] }) => {
    set((state) => ({
      modelsByProvider: {
        ...state.modelsByProvider,
        [provider]: models,
      },
    }))

    // Ensure consistency after models are loaded
    get().ensureProviderModelConsistency()
  },
  
  refreshModels: async (provider: 'openai' | 'anthropic' | 'gemini') => {
    try {
      // Inline the models fetching logic directly here
      const key = await getProviderKey(provider)
      if (!key) {
        set((state) => ({
          modelsByProvider: {
            ...state.modelsByProvider,
            [provider]: [],
          },
        }))
        return
      }

      let list: ModelOption[] = []

      if (provider === 'openai') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: key })
        const res: any = await client.models.list()
        const ids: string[] = (res?.data || [])
          .map((m: any) => m?.id)
          .filter((id: any) => typeof id === 'string')

        const allowed = ids.filter((id) =>
          /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/i.test(id) &&
          !/realtime/i.test(id) &&
          !/(whisper|audio|tts|speech|embedding|embeddings)/i.test(id)
        )
        const uniq = Array.from(new Set(allowed))

        const allowPriority = [
          'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4', 'o4-mini', 'o3-mini',
        ]
        const withLabels = uniq.map((id) => ({ id, label: id }))
        withLabels.sort((a, b) => {
          const ia = allowPriority.findIndex((p) => a.id.startsWith(p))
          const ib = allowPriority.findIndex((p) => b.id.startsWith(p))
          if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
          return a.id.localeCompare(b.id)
        })

        list = withLabels.map((m) => ({ value: m.id, label: m.label }))
      } else if (provider === 'anthropic') {
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
        // Use all models returned by the API - they're all usable
        const uniq = Array.from(new Set(ids))
        list = uniq.map((id) => ({ value: id, label: id }))
      } else if (provider === 'gemini') {
        const f: any = (globalThis as any).fetch
        if (!f) throw new Error('Fetch API unavailable')
        const resp = await f(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        const arr = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : []
        const models = arr.map((m: any) => {
          const full = (m?.name || m?.model || '').toString()
          const id = full.startsWith('models/') ? full.split('/').pop() : full
          const supported: string[] = (m?.supportedGenerationMethods || m?.supported_generation_methods || [])
          return { id, label: id, supported }
        }).filter((m: any) => {
          const id = m.id || ''
          const hasGenerate = m.supported?.includes('generateContent')
          const isNotEmbedding = !/(embedding|vision)/i.test(id)
          const isNotImageGen = !/image-generation/i.test(id)
          return hasGenerate && isNotEmbedding && isNotImageGen
        })
        list = models.map((m: any) => ({ value: m.id, label: m.label }))
      }

      
      set((state) => ({
        modelsByProvider: {
          ...state.modelsByProvider,
          [provider]: list,
        },
      }))
      
      // Auto-select first model as default if no default is set OR if current default is not in the list
      const state = get()
      const currentDefault = state.defaultModels?.[provider]
      const isCurrentDefaultValid = currentDefault && list.some((m) => m.value === currentDefault)
      
      if (list.length > 0 && !isCurrentDefaultValid) {
        const firstModel = list[0].value
        state.setDefaultModel({ provider, model: firstModel })
      }
    } catch (e) {
      console.error('[provider] Failed to refresh models for', provider, ':', e)
      set((state) => ({
        modelsByProvider: {
          ...state.modelsByProvider,
          [provider]: [],
        },
      }))
    }
  },
  
  refreshAllModels: async () => {
    const providers: Array<'openai' | 'anthropic' | 'gemini'> = ['openai', 'anthropic', 'gemini']
    
    for (const provider of providers) {
      try {
        await get().refreshModels(provider)
      } catch (e) {
        console.error('[provider] Failed to refresh models for', provider, ':', e)
      }
    }
  },
  
  setDefaultModel: ({ provider, model }: { provider: string; model: string }) => {
    set((state) => {
      const next = {
        ...state.defaultModels,
        [provider]: model,
      }


      return { defaultModels: next }
    })
  },
  
  pushRouteRecord: (record: RouteRecord) => {
    set((state) => ({
      routeHistory: [record, ...state.routeHistory].slice(0, MAX_ROUTE_HISTORY),
    }))
  },
  
  ensureProviderModelConsistency: () => {
    const state = get()
    const validMap = state.providerValid || {}
    const anyValidated = Object.values(validMap).some(Boolean)

    // Get list of valid providers, or all providers if none are validated yet
    const providerOptions = anyValidated
      ? (['openai', 'anthropic', 'gemini'] as const).filter((p) => validMap[p])
      : (['openai', 'anthropic', 'gemini'] as const)

    let provider = state.selectedProvider

    // If current provider is not in the valid list, switch to first valid provider
    if (!providerOptions.includes(provider as any) && providerOptions.length > 0) {
      provider = providerOptions[0]
      set({ selectedProvider: provider })
    }

    // Get models for current provider
    const models = state.modelsByProvider[provider] || []

    // Check if current model is valid for this provider
    const currentModelValid = models.some((m) => m.value === state.selectedModel)

    // Only auto-select a model if the current one is invalid
    if (!currentModelValid && models.length > 0) {
      // Check if we have a preferred default model for this provider
      const preferred = state.defaultModels?.[provider]
      const hasPreferred = preferred && models.some((m) => m.value === preferred)

      if (hasPreferred) {
        // Use preferred model if it's available
        set({ selectedModel: preferred })
      } else {
        // Otherwise use first available model
        const first = models[0]
        set({ selectedModel: first.value })
      }
    }
  },
})

