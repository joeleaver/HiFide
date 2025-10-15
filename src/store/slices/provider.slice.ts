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
import { LS_KEYS, DEFAULTS, MAX_ROUTE_HISTORY } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage } from '../utils/persistence'
import { listModels } from '../../services/models'

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
  setProviderValid: (provider: string, valid: boolean) => void
  setProvidersValid: (map: Record<string, boolean>) => void
  setModelsForProvider: (provider: string, models: ModelOption[]) => void
  refreshModels: (provider: 'openai' | 'anthropic' | 'gemini') => Promise<void>
  refreshAllModels: () => Promise<void>
  setDefaultModel: (provider: string, model: string) => void
  pushRouteRecord: (record: RouteRecord) => void
  ensureProviderModelConsistency: () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createProviderSlice: StateCreator<ProviderSlice, [], [], ProviderSlice> = (set, get) => ({
  // State - Initialize from localStorage
  selectedModel: getFromLocalStorage<string>(LS_KEYS.SELECTED_MODEL, DEFAULTS.SELECTED_MODEL),
  selectedProvider: getFromLocalStorage<string>(LS_KEYS.SELECTED_PROVIDER, DEFAULTS.SELECTED_PROVIDER),
  autoRetry: getFromLocalStorage<boolean>(LS_KEYS.AUTO_RETRY, DEFAULTS.AUTO_RETRY),
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
  defaultModels: getFromLocalStorage<Record<string, string>>(LS_KEYS.DEFAULT_MODELS, {}),
  routeHistory: [],
  
  // Actions
  setSelectedModel: (model: string) => {
    set({ selectedModel: model })
    setInLocalStorage(LS_KEYS.SELECTED_MODEL, model)
    console.debug('[provider] Selected model:', model)
  },
  
  setSelectedProvider: (provider: string) => {
    set({ selectedProvider: provider })
    setInLocalStorage(LS_KEYS.SELECTED_PROVIDER, provider)
    console.debug('[provider] Selected provider:', provider)

    // Immediately update model to match new provider
    const state = get()
    const models = state.modelsByProvider[provider] || []

    // Check if we have a preferred default model for this provider
    const preferred = state.defaultModels?.[provider]
    const hasPreferred = preferred && models.some((m) => m.value === preferred)

    if (hasPreferred) {
      // Use preferred model if it's available
      set({ selectedModel: preferred })
      setInLocalStorage(LS_KEYS.SELECTED_MODEL, preferred)
      console.log('[provider] Using preferred model for new provider:', preferred)
    } else if (models.length > 0) {
      // Otherwise use first available model
      const first = models[0]
      set({ selectedModel: first.value })
      setInLocalStorage(LS_KEYS.SELECTED_MODEL, first.value)
      console.log('[provider] Selected first available model for new provider:', first.value)
    }
  },
  
  setAutoRetry: (value: boolean) => {
    set({ autoRetry: value })
    setInLocalStorage(LS_KEYS.AUTO_RETRY, value)
    console.debug('[provider] Auto-retry:', value)
  },
  
  setProviderValid: (provider: string, valid: boolean) => {
    set((state) => ({
      providerValid: {
        ...state.providerValid,
        [provider]: valid,
      },
    }))
    console.debug('[provider] Provider validation:', provider, valid)
  },
  
  setProvidersValid: (map: Record<string, boolean>) => {
    set((state) => ({
      providerValid: {
        ...state.providerValid,
        ...map,
      },
    }))
    console.debug('[provider] Providers validation:', map)
  },
  
  setModelsForProvider: (provider: string, models: ModelOption[]) => {
    set((state) => ({
      modelsByProvider: {
        ...state.modelsByProvider,
        [provider]: models,
      },
    }))
    console.debug('[provider] Models for', provider, ':', models.length)
  },
  
  refreshModels: async (provider: 'openai' | 'anthropic' | 'gemini') => {
    try {
      const res = await listModels(provider)
      let list: ModelOption[] = []
      
      if (res?.ok && Array.isArray(res.models)) {
        const arr = res.models as any[]
        // Main process already filtered appropriately
        list = arr
          .filter((m) => !!m?.id)
          .map((m) => ({
            value: String(m.id),
            label: String(m.label || m.id),
          }))
      }
      
      console.log('[provider] Refreshed models for', provider, ':', list.length)
      
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
        console.log(
          '[provider] Auto-selecting default for',
          provider,
          ':',
          firstModel,
          '(current:',
          currentDefault || 'none',
          ', valid:',
          isCurrentDefaultValid,
          ')'
        )
        state.setDefaultModel(provider, firstModel)
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
  
  setDefaultModel: (provider: string, model: string) => {
    set((state) => {
      const next = {
        ...state.defaultModels,
        [provider]: model,
      }
      
      console.log('[provider] Set default model for', provider, '=', model, ', full defaults:', next)
      setInLocalStorage(LS_KEYS.DEFAULT_MODELS, next)
      
      return { defaultModels: next }
    })
  },
  
  pushRouteRecord: (record: RouteRecord) => {
    set((state) => ({
      routeHistory: [record, ...state.routeHistory].slice(0, MAX_ROUTE_HISTORY),
    }))
    console.debug('[provider] Route record added:', record.mode, record.provider, record.model)
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
      setInLocalStorage(LS_KEYS.SELECTED_PROVIDER, provider)
      console.log('[provider] Switched to valid provider:', provider)
    }
    
    // Get models for current provider
    const models = state.modelsByProvider[provider] || []
    
    // Check if we have a preferred default model for this provider
    const preferred = state.defaultModels?.[provider]
    const hasPreferred = preferred && models.some((m) => m.value === preferred)
    
    if (hasPreferred) {
      // Use preferred model if it's available
      if (state.selectedModel !== preferred) {
        set({ selectedModel: preferred })
        setInLocalStorage(LS_KEYS.SELECTED_MODEL, preferred)
        console.log('[provider] Using preferred model:', preferred)
      }
      return
    }
    
    // If current model is not in the list, select first available model
    if (!models.find((m) => m.value === state.selectedModel)) {
      const first = models[0]
      if (first?.value) {
        set({ selectedModel: first.value })
        setInLocalStorage(LS_KEYS.SELECTED_MODEL, first.value)
        console.log('[provider] Selected first available model:', first.value)
      }
    }
  },
})

