/**
 * Settings Slice
 * 
 * Manages application settings and configuration.
 * 
 * Responsibilities:
 * - API keys management (load, save, validate)

 * - Auto-enforce edits schema
 * - Pricing configuration
 * - Rate limit configuration
 * 
 * Dependencies:
 * - Provider slice (for provider validation updates)
 * - App slice (for startup message clearing)
 */

import type { StateCreator } from 'zustand'
import type { ApiKeys, ModelPricing, PricingConfig, TokenUsage, TokenCost } from '../types'
import { DEFAULT_PRICING } from '../../data/defaultPricing'

// ============================================================================
// Types
// ============================================================================

export interface SettingsSlice {
  // API Keys State
  settingsApiKeys: ApiKeys
  settingsSaving: boolean
  settingsSaved: boolean
  settingsSaveResult: { ok: boolean; failures: string[] } | null
  settingsValidateResult: { ok: boolean; failures: string[] } | null



  // Pricing State
  pricingConfig: PricingConfig
  defaultPricingConfig: PricingConfig  // Immutable reference to DEFAULT_PRICING for UI comparison

  // API Keys Actions
  setOpenAiApiKey: (value: string) => void
  setAnthropicApiKey: (value: string) => void
  setGeminiApiKey: (value: string) => void
  loadSettingsApiKeys: () => Promise<void>
  saveSettingsApiKeys: () => Promise<void>
  validateApiKeys: () => Promise<{ ok: boolean; failures: string[] }>
  resetSettingsSaved: () => void
  clearSettingsResults: () => void
  


  // Pricing Actions
  setPricingForModel: (params: { provider: string; model: string; pricing: ModelPricing }) => void
  resetPricingToDefaults: () => void
  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini') => void
  calculateCost: (provider: string, model: string, usage: TokenUsage) => TokenCost | null
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  // State - Initialized with defaults, persist middleware will restore saved values
  settingsApiKeys: {
    openai: '',
    anthropic: '',
    gemini: '',
  },
  settingsSaving: false,
  settingsSaved: false,
  settingsSaveResult: null,
  settingsValidateResult: null,



  pricingConfig: DEFAULT_PRICING,
  defaultPricingConfig: DEFAULT_PRICING,  // Immutable reference for UI comparison

  // API Keys Actions - separate action for each provider (zubridge dispatch only supports single payload)
  setOpenAiApiKey: (value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        openai: value || '',
      },
      settingsSaved: false,
    }))
  },

  setAnthropicApiKey: (value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        anthropic: value || '',
      },
      settingsSaved: false,
    }))
  },

  setGeminiApiKey: (value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        gemini: value || '',
      },
      settingsSaved: false,
    }))
  },
  
  loadSettingsApiKeys: async () => {
    // In the new architecture, API keys are loaded at app startup into the store
    // This function is kept for compatibility but is a no-op
    // The actual loading happens in app.slice.ts initializeApp()
  },
  
  saveSettingsApiKeys: async () => {
    // API keys are stored in settingsApiKeys state and automatically persisted
    // via the Zustand persist middleware to electron-store in the main process
    // The keys are already in the store and will be auto-persisted

    set({ settingsSaving: true, settingsSaved: false, settingsSaveResult: null })

    try {
      // Just mark as saved - persistence happens automatically via middleware
      set({
        settingsSaved: true,
        settingsSaving: false,
        settingsSaveResult: { ok: true, failures: [] }
      })
    } catch (e: any) {
      set({
        settingsSaving: false,
        settingsSaveResult: { ok: false, failures: [`Unexpected error: ${e?.message || String(e)}`] }
      })
      console.error('[settings] Save error:', e)
    }
  },

  validateApiKeys: async () => {
    // Validate API keys by making test API calls
    // This can only run in the main process where we have Node.js APIs
    if (typeof window !== 'undefined') {
      const result = { ok: true, failures: [] as string[] }
      set({ settingsValidateResult: result })
      return result
    }

    set({ settingsValidateResult: null })

    try {
      const state = get()
      const keys = state.settingsApiKeys
      const failures: string[] = []

      // Validate OpenAI
      if (keys.openai?.trim()) {
        try {
          const { default: OpenAI } = await import('openai')
          const client = new OpenAI({ apiKey: keys.openai })
          await client.models.list()
        } catch (e: any) {
          failures.push(`OpenAI: ${e?.message || String(e)}`)
        }
      }

      // Validate Anthropic
      if (keys.anthropic?.trim()) {
        try {
          // Use the free /v1/models endpoint instead of making a paid API call
          const f: any = (globalThis as any).fetch
          if (!f) {
            failures.push('Anthropic: Fetch API unavailable')
          } else {
            const resp = await f('https://api.anthropic.com/v1/models', {
              method: 'GET',
              headers: {
                'x-api-key': keys.anthropic,
                'anthropic-version': '2023-06-01'
              },
            })
            if (resp.ok) {
            } else {
              const txt = await resp.text().catch(() => '')
              failures.push(`Anthropic: HTTP ${resp.status}: ${txt.slice(0, 100)}`)
            }
          }
        } catch (e: any) {
          failures.push(`Anthropic: ${e?.message || String(e)}`)
        }
      }

      // Validate Gemini
      if (keys.gemini?.trim()) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(keys.gemini)}`
          const f: any = (globalThis as any).fetch
          if (!f) {
            failures.push('Gemini: Fetch API unavailable')
          } else {
            const resp = await f(url, { method: 'GET' })
            if (resp.ok) {
            } else {
              const txt = await resp.text().catch(() => '')
              failures.push(`Gemini: HTTP ${resp.status}: ${txt.slice(0, 100)}`)
            }
          }
        } catch (e: any) {
          failures.push(`Gemini: ${e?.message || String(e)}`)
        }
      }

      const result = failures.length > 0
        ? { ok: false, failures }
        : { ok: true, failures: [] }

      // Update provider validity map and refresh models so UI reacts immediately
      try {
        const lc = failures.map((f) => f.toLowerCase())
        const map: Record<string, boolean> = {
          openai: !!keys.openai?.trim() && !lc.some((f) => f.includes('openai')),
          anthropic: !!keys.anthropic?.trim() && !lc.some((f) => f.includes('anthropic')),
          gemini: !!keys.gemini?.trim() && !lc.some((f) => f.includes('gemini')),
        }
        const anyState: any = state as any
        anyState.setProvidersValid?.(map)
        // Clear startup banner if at least one provider is valid now
        if (map.openai || map.anthropic || map.gemini) {
          anyState.setStartupMessage?.(null)
        }
        // Fetch models for newly valid providers
        void anyState.refreshAllModels?.()
      } catch {}

      set({ settingsValidateResult: result })

      return result
    } catch (e: any) {
      const error = `Unexpected error: ${e?.message || String(e)}`
      console.error('[settings]', error)
      const result = { ok: false, failures: [error] }
      set({ settingsValidateResult: result })
      return result
    }
  },

  resetSettingsSaved: () => {
    set({ settingsSaved: false })
  },

  clearSettingsResults: () => {
    set({ settingsSaveResult: null, settingsValidateResult: null })
  },
  


  // Pricing Actions
  setPricingForModel: ({ provider, model, pricing }: { provider: string; model: string; pricing: ModelPricing }) => {
    set((state) => {
      const newConfig = {
        ...state.pricingConfig,
        [provider]: {
          ...(state.pricingConfig[provider as keyof PricingConfig] as any),
          [model]: pricing,
        },
        customRates: true,
      }

      return { pricingConfig: newConfig }
    })

  },

  resetPricingToDefaults: () => {
    set({ pricingConfig: DEFAULT_PRICING })
  },
  
  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini') => {
    set((state) => {
      const newConfig = {
        ...state.pricingConfig,
        [provider]: DEFAULT_PRICING[provider],
      }
      
      // Check if any provider still has custom rates
      const hasCustomRates = (['openai', 'anthropic', 'gemini'] as const).some(
        (p) =>
          p !== provider &&
          JSON.stringify(newConfig[p]) !== JSON.stringify(DEFAULT_PRICING[p])
      )
      
      const finalConfig = {
        ...newConfig,
        customRates: hasCustomRates,
      }

      return { pricingConfig: finalConfig }
    })

  },
  
  calculateCost: (provider: string, model: string, usage: TokenUsage): TokenCost | null => {
    const state = get()
    const config = state.pricingConfig[provider as keyof PricingConfig]

    if (typeof config === 'boolean') return null

    const pricing = (config as any)?.[model] as ModelPricing | undefined
    if (!pricing) return null

    // Calculate costs with cache awareness
    const cachedTokens = usage.cachedTokens || 0
    const normalInputTokens = usage.inputTokens - cachedTokens

    // Normal input tokens at full price
    const normalInputCost = (normalInputTokens / 1_000_000) * pricing.inputCostPer1M

    // Cached tokens at reduced price (if pricing available)
    const cachedInputCost = pricing.cachedInputCostPer1M
      ? (cachedTokens / 1_000_000) * pricing.cachedInputCostPer1M
      : (cachedTokens / 1_000_000) * pricing.inputCostPer1M  // Fallback to normal price

    const inputCost = normalInputCost + cachedInputCost
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPer1M

    // Calculate savings if caching was used
    let savings = 0
    let savingsPercent = 0
    if (cachedTokens > 0 && pricing.cachedInputCostPer1M) {
      // Savings = what we would have paid at full price - what we actually paid
      const fullPriceCost = (cachedTokens / 1_000_000) * pricing.inputCostPer1M
      savings = fullPriceCost - cachedInputCost
      const totalWithoutSavings = inputCost + outputCost + savings
      savingsPercent = totalWithoutSavings > 0 ? (savings / totalWithoutSavings) * 100 : 0
    }

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
      cachedInputCost: cachedTokens > 0 ? cachedInputCost : undefined,
      savings: savings > 0 ? savings : undefined,
      savingsPercent: savingsPercent > 0 ? savingsPercent : undefined,
    }
  },
})

