/**
 * Settings Slice
 * 
 * Manages application settings and configuration.
 * 
 * Responsibilities:
 * - API keys management (load, save, validate)
 * - Auto-approve settings
 * - Auto-enforce edits schema
 * - Pricing configuration
 * - Rate limit configuration
 * 
 * Dependencies:
 * - Provider slice (for provider validation updates)
 * - App slice (for startup message clearing)
 */

import type { StateCreator } from 'zustand'
import type { ApiKeys, ModelPricing, PricingConfig, RateLimitConfig, RateLimitKind, TokenUsage, TokenCost } from '../types'
import { LS_KEYS, DEFAULTS } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage, removeFromLocalStorage } from '../utils/persistence'
import { DEFAULT_PRICING } from '../../data/defaultPricing'

// ============================================================================
// Types
// ============================================================================

export interface SettingsSlice {
  // API Keys State
  settingsApiKeys: ApiKeys
  settingsSaving: boolean
  settingsSaved: boolean
  
  // Auto-approve State
  autoApproveEnabled: boolean
  autoApproveThreshold: number
  
  // Agent Behavior State
  autoEnforceEditsSchema: boolean
  
  // Pricing State
  pricingConfig: PricingConfig
  
  // Rate Limit State
  rateLimitConfig: RateLimitConfig
  
  // API Keys Actions
  setSettingsApiKey: (provider: 'openai' | 'anthropic' | 'gemini', value: string) => void
  loadSettingsApiKeys: () => Promise<void>
  saveSettingsApiKeys: () => Promise<{ ok: boolean; failures: string[] }>
  resetSettingsSaved: () => void
  
  // Auto-approve Actions
  setAutoApproveEnabled: (value: boolean) => void
  setAutoApproveThreshold: (value: number) => void
  
  // Agent Behavior Actions
  setAutoEnforceEditsSchema: (value: boolean) => void
  
  // Pricing Actions
  setPricingForModel: (provider: string, model: string, pricing: ModelPricing) => void
  resetPricingToDefaults: () => void
  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini') => void
  calculateCost: (provider: string, model: string, usage: TokenUsage) => TokenCost | null
  
  // Rate Limit Actions
  setRateLimitForModel: (provider: 'openai' | 'anthropic' | 'gemini', model: string, limits: RateLimitKind) => Promise<void>
  toggleRateLimiting: (enabled: boolean) => Promise<void>
  loadRateLimitConfig: () => Promise<void>
  saveRateLimitConfig: () => Promise<void>
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  // State - Initialize from localStorage
  settingsApiKeys: {
    openai: '',
    anthropic: '',
    gemini: '',
  },
  settingsSaving: false,
  settingsSaved: false,
  
  autoApproveEnabled: getFromLocalStorage<boolean>(LS_KEYS.AUTO_APPROVE_ENABLED, DEFAULTS.AUTO_APPROVE_ENABLED),
  autoApproveThreshold: getFromLocalStorage<number>(LS_KEYS.AUTO_APPROVE_THRESHOLD, DEFAULTS.AUTO_APPROVE_THRESHOLD),
  
  autoEnforceEditsSchema: getFromLocalStorage<boolean>(LS_KEYS.AUTO_ENFORCE_EDITS_SCHEMA, DEFAULTS.AUTO_ENFORCE_EDITS_SCHEMA),
  
  pricingConfig: getFromLocalStorage<PricingConfig>(LS_KEYS.PRICING_CONFIG, DEFAULT_PRICING),
  
  rateLimitConfig: { enabled: false },
  
  // API Keys Actions
  setSettingsApiKey: (provider: 'openai' | 'anthropic' | 'gemini', value: string) => {
    set((state) => ({
      settingsApiKeys: {
        ...state.settingsApiKeys,
        [provider]: value,
      },
      settingsSaved: false,
    }))
  },
  
  loadSettingsApiKeys: async () => {
    try {
      const [okey, akey, gkey] = await Promise.all([
        window.secrets?.getApiKeyFor?.('openai'),
        window.secrets?.getApiKeyFor?.('anthropic'),
        window.secrets?.getApiKeyFor?.('gemini'),
      ])
      
      set({
        settingsApiKeys: {
          openai: okey || '',
          anthropic: akey || '',
          gemini: gkey || '',
        },
      })
      
      console.debug('[settings] API keys loaded')
    } catch (e) {
      console.error('[settings] Failed to load API keys:', e)
    }
  },
  
  saveSettingsApiKeys: async () => {
    set({ settingsSaving: true, settingsSaved: false })
    const failures: string[] = []
    
    try {
      const state = get() as any
      const keys = state.settingsApiKeys
      
      // Save keys to electron-store (via IPC)
      await window.secrets?.setApiKeyFor?.('openai', keys.openai.trim())
      await window.secrets?.setApiKeyFor?.('anthropic', keys.anthropic.trim())
      await window.secrets?.setApiKeyFor?.('gemini', keys.gemini.trim())
      
      // Validate keys (best-effort)
      const vOpenAI = keys.openai
        ? await window.secrets?.validateApiKeyFor?.('openai', keys.openai)
        : { ok: true }
      const vAnth = keys.anthropic
        ? await window.secrets?.validateApiKeyFor?.('anthropic', keys.anthropic, 'claude-3-5-sonnet')
        : { ok: true }
      const vGem = keys.gemini
        ? await window.secrets?.validateApiKeyFor?.('gemini', keys.gemini, 'gemini-1.5-pro')
        : { ok: true }
      
      if (!vOpenAI?.ok) failures.push(`OpenAI: ${vOpenAI?.error || 'invalid key'}`)
      if (!vAnth?.ok) failures.push(`Anthropic: ${vAnth?.error || 'invalid key'}`)
      if (!vGem?.ok) failures.push(`Gemini: ${vGem?.error || 'invalid key'}`)
      
      const validMap = {
        openai: Boolean(keys.openai && vOpenAI?.ok),
        anthropic: Boolean(keys.anthropic && vAnth?.ok),
        gemini: Boolean(keys.gemini && vGem?.ok),
      }
      
      console.log('[settings] Validation results:', validMap)
      
      // Update provider validation state (from provider slice)
      if (state.setProvidersValid) {
        state.setProvidersValid(validMap)
      }
      
      // Clear startup message if we now have at least one valid key
      if (validMap.openai || validMap.anthropic || validMap.gemini) {
        if (state.setStartupMessage) {
          state.setStartupMessage(null)
        }
      }
      
      // Refresh models for valid providers
      await Promise.all(
        (['openai', 'anthropic', 'gemini'] as const).map(async (p) => {
          if (validMap[p]) {
            console.log('[settings] Refreshing models for', p)
            try {
              if (state.refreshModels) {
                await state.refreshModels(p)
              }
              console.log('[settings] Models for', p, ':', state.modelsByProvider?.[p]?.length || 0)
            } catch (e) {
              console.error('[settings] Failed to refresh models for', p, ':', e)
            }
          }
        })
      )
      
      set({ settingsSaved: true })
      return { ok: failures.length === 0, failures }
    } catch (e: any) {
      failures.push(`Unexpected error: ${e?.message || String(e)}`)
      return { ok: false, failures }
    } finally {
      set({ settingsSaving: false })
    }
  },
  
  resetSettingsSaved: () => {
    set({ settingsSaved: false })
  },
  
  // Auto-approve Actions
  setAutoApproveEnabled: (value: boolean) => {
    set({ autoApproveEnabled: value })
    setInLocalStorage(LS_KEYS.AUTO_APPROVE_ENABLED, value)
    console.debug('[settings] Auto-approve enabled:', value)
  },
  
  setAutoApproveThreshold: (value: number) => {
    // Clamp between 0 and 1
    const clamped = Math.max(0, Math.min(1, value))
    set({ autoApproveThreshold: clamped })
    setInLocalStorage(LS_KEYS.AUTO_APPROVE_THRESHOLD, clamped)
    console.debug('[settings] Auto-approve threshold:', clamped)
  },
  
  // Agent Behavior Actions
  setAutoEnforceEditsSchema: (value: boolean) => {
    set({ autoEnforceEditsSchema: value })
    setInLocalStorage(LS_KEYS.AUTO_ENFORCE_EDITS_SCHEMA, value)
    console.debug('[settings] Auto-enforce edits schema:', value)
  },
  
  // Pricing Actions
  setPricingForModel: (provider: string, model: string, pricing: ModelPricing) => {
    set((state) => {
      const newConfig = {
        ...state.pricingConfig,
        [provider]: {
          ...(state.pricingConfig[provider as keyof PricingConfig] as any),
          [model]: pricing,
        },
        customRates: true,
      }
      
      setInLocalStorage(LS_KEYS.PRICING_CONFIG, newConfig)
      return { pricingConfig: newConfig }
    })
    
    console.debug('[settings] Pricing set for', provider, model)
  },
  
  resetPricingToDefaults: () => {
    set({ pricingConfig: DEFAULT_PRICING })
    removeFromLocalStorage(LS_KEYS.PRICING_CONFIG)
    console.log('[settings] Pricing reset to defaults')
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
      
      setInLocalStorage(LS_KEYS.PRICING_CONFIG, finalConfig)
      return { pricingConfig: finalConfig }
    })
    
    console.log('[settings] Pricing reset for', provider)
  },
  
  calculateCost: (provider: string, model: string, usage: TokenUsage): TokenCost | null => {
    const state = get()
    const config = state.pricingConfig[provider as keyof PricingConfig]
    
    if (typeof config === 'boolean') return null
    
    const pricing = (config as any)?.[model] as ModelPricing | undefined
    if (!pricing) return null
    
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputCostPer1M
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPer1M
    
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
    }
  },
  
  // Rate Limit Actions
  loadRateLimitConfig: async () => {
    try {
      const cfg = await (window as any).ratelimits?.get?.()
      if (cfg) {
        set({ rateLimitConfig: cfg })
        console.debug('[settings] Rate limit config loaded')
      }
    } catch (e) {
      console.error('[settings] Failed to load rate limit config:', e)
    }
  },
  
  saveRateLimitConfig: async () => {
    try {
      const state = get()
      await (window as any).ratelimits?.set?.(state.rateLimitConfig)
      console.debug('[settings] Rate limit config saved')
    } catch (e) {
      console.error('[settings] Failed to save rate limit config:', e)
    }
  },
  
  toggleRateLimiting: async (enabled: boolean) => {
    set((state) => ({
      rateLimitConfig: {
        ...(state.rateLimitConfig || { enabled }),
        enabled,
      },
    }))
    
    try {
      const state = get()
      await (window as any).ratelimits?.set?.(state.rateLimitConfig)
      console.debug('[settings] Rate limiting toggled:', enabled)
    } catch (e) {
      console.error('[settings] Failed to toggle rate limiting:', e)
    }
  },
  
  setRateLimitForModel: async (
    provider: 'openai' | 'anthropic' | 'gemini',
    model: string,
    limits: RateLimitKind
  ) => {
    set((state) => ({
      rateLimitConfig: {
        ...(state.rateLimitConfig || { enabled: false }),
        [provider]: {
          ...((state.rateLimitConfig as any)?.[provider] || {}),
          [model]: limits,
        },
      },
    }))
    
    try {
      const state = get()
      await (window as any).ratelimits?.set?.(state.rateLimitConfig)
      console.debug('[settings] Rate limit set for', provider, model)
    } catch (e) {
      console.error('[settings] Failed to set rate limit:', e)
    }
  },
})

