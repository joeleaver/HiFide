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
  setFireworksApiKey: (value: string) => void
  setXaiApiKey: (value: string) => void
  loadSettingsApiKeys: () => Promise<void>
  saveSettingsApiKeys: () => Promise<void>
  validateApiKeys: () => Promise<{ ok: boolean; failures: string[] }>
  resetSettingsSaved: () => void
  clearSettingsResults: () => void



  // Pricing Actions
  setPricingForModel: (params: { provider: string; model: string; pricing: ModelPricing }) => void
  resetPricingToDefaults: () => void
  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai') => void
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
    fireworks: '',
    xai: '',
  },
  settingsSaving: false,
  settingsSaved: false,
  settingsSaveResult: null,
  settingsValidateResult: null,



  pricingConfig: DEFAULT_PRICING,
  defaultPricingConfig: DEFAULT_PRICING,  // Immutable reference for UI comparison

  // API Keys Actions - separate action per provider for clarity; renderer calls these via JSON-RPC
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

  setFireworksApiKey: (value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        fireworks: value || '',
      },
      settingsSaved: false,
    }))
  },

  setXaiApiKey: (value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        xai: value || '',
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

      // Ensure validation cannot hang forever: add a soft timeout to each network call
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

      // Run all provider validations in parallel (much faster than sequential)
      const checks: Array<Promise<string | null>> = []

      if (keys.openai?.trim()) {
        checks.push((async () => {
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
        })())
      }

      if (keys.anthropic?.trim()) {
        checks.push((async () => {
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
        })())
      }

      if (keys.gemini?.trim()) {
        checks.push((async () => {
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
        })())
      }

      if (keys.fireworks?.trim()) {
        checks.push((async () => {
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
        })())
      }

      if ((keys as any).xai?.trim()) {
        checks.push((async () => {
          try {
            const resp = await fetchWithTimeout('https://api.x.ai/v1/models', {
              method: 'GET',
              headers: { Authorization: `Bearer ${(keys as any).xai}` },
            })
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '')
              return `xAI: HTTP ${resp.status}: ${txt.slice(0, 100)}`
            }
          } catch (e: any) {
            return `xAI: ${e?.message || String(e)}`
          }
          return null
        })())
      }

      const results = await Promise.all(checks)
      const failures = results.filter((r): r is string => !!r)

      const result = failures.length > 0
        ? { ok: false, failures }
        : { ok: true, failures: [] }

      console.log('[settings] validateApiKeys results', {
        ok: result.ok,
        failureCount: failures.length,
        failures,
        hasKeys: {
          openai: !!keys.openai?.trim(),
          anthropic: !!keys.anthropic?.trim(),
          gemini: !!keys.gemini?.trim(),
          fireworks: !!keys.fireworks?.trim(),
          xai: !!(keys as any).xai?.trim(),
        },
      })

      // Update provider validity map and refresh models so UI reacts immediately
      try {
        const lc = failures.map((f) => f.toLowerCase())
        const map: Record<string, boolean> = {
          openai: !!keys.openai?.trim() && !lc.some((f) => f.includes('openai')),
          anthropic: !!keys.anthropic?.trim() && !lc.some((f) => f.includes('anthropic')),
          gemini: !!keys.gemini?.trim() && !lc.some((f) => f.includes('gemini')),
          fireworks: !!keys.fireworks?.trim() && !lc.some((f) => f.includes('fireworks')),
          xai: !!(keys as any).xai?.trim() && !lc.some((f) => f.includes('xai')),
        }
        const anyState: any = state as any
        anyState.setProvidersValid?.(map)
        // Clear startup banner if at least one provider is valid now
        if (map.openai || map.anthropic || map.gemini || map.fireworks || map.xai) {
          anyState.setStartupMessage?.(null)
        }
        // Fetch models for newly valid providers (non-blocking)
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

  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai') => {
    set((state) => {
      const newConfig = {
        ...state.pricingConfig,
        [provider]: DEFAULT_PRICING[provider as keyof typeof DEFAULT_PRICING],
      }

      // Check if any provider still has custom rates
      const hasCustomRates = (['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const).some(
        (p) =>
          p !== provider &&
          JSON.stringify((newConfig as any)[p]) !== JSON.stringify((DEFAULT_PRICING as any)[p])
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

    // IMPORTANT: cachedTokens is SEPARATE from inputTokens, not included in it.
    // Providers report: inputTokens (total), cachedTokens (subset that was cached)
    // So we need to calculate: (inputTokens - cachedTokens) at full price + cachedTokens at reduced price

    const cachedTokens = usage.cachedTokens || 0
    const totalInputTokens = usage.inputTokens || 0
    const normalInputTokens = Math.max(0, totalInputTokens - cachedTokens)

    // Get cached pricing (fallback to full price if not configured)
    const cachedInputCostPer1M = (pricing as any).cachedInputCostPer1M ?? pricing.inputCostPer1M

    // Calculate costs
    const normalInputCost = (normalInputTokens / 1_000_000) * pricing.inputCostPer1M
    const cachedInputCost = (cachedTokens / 1_000_000) * cachedInputCostPer1M
    const inputCost = normalInputCost + cachedInputCost
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPer1M

    // Calculate savings if caching was used
    let savings = 0
    let savingsPercent = 0
    if (cachedTokens > 0 && cachedInputCostPer1M < pricing.inputCostPer1M) {
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

