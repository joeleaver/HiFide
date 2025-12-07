import { create } from 'zustand'
import { notifications } from '@mantine/notifications'
import { getBackendClient } from '../lib/backend/bootstrap'
import type { PricingConfig, ModelPricing, ProviderPricing } from '../../electron/store/types'

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const

type ProviderName = (typeof PROVIDERS)[number]

type PricingChange = {
  provider: ProviderName
  model: string
  pricing: ModelPricing
}

function cloneConfig(config?: PricingConfig | null): PricingConfig {
  if (!config) {
    return {
      openai: {},
      anthropic: {},
      gemini: {},
      fireworks: {},
      xai: {},
      customRates: false,
    }
  }
  return JSON.parse(JSON.stringify(config)) as PricingConfig
}

function cloneProvider(pricing?: ProviderPricing): ProviderPricing {
  return JSON.parse(JSON.stringify(pricing || {})) as ProviderPricing
}

function pricingEquals(a?: ModelPricing, b?: ModelPricing): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.inputCostPer1M === b.inputCostPer1M &&
    a.outputCostPer1M === b.outputCostPer1M &&
    (a.cachedInputCostPer1M ?? null) === (b.cachedInputCostPer1M ?? null)
  )
}

function providerEquals(a?: ProviderPricing, b?: ProviderPricing): boolean {
  const keys = new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])])
  for (const key of keys) {
    if (!pricingEquals(a?.[key], b?.[key])) {
      return false
    }
  }
  return true
}

function computeDirtyProviders(baseline: PricingConfig | null, draft: PricingConfig | null): ProviderName[] {
  if (!baseline || !draft) return []
  return PROVIDERS.filter((provider) => !providerEquals(baseline[provider], draft[provider]))
}

function diffPricing(baseline: PricingConfig, draft: PricingConfig): PricingChange[] {
  const changes: PricingChange[] = []
  for (const provider of PROVIDERS) {
    const baseProvider = baseline[provider] || {}
    const draftProvider = draft[provider] || {}
    const models = new Set([...Object.keys(baseProvider), ...Object.keys(draftProvider)])
    models.forEach((model) => {
      if (!pricingEquals(baseProvider[model], draftProvider[model])) {
        const pricing = draftProvider[model]
        if (pricing) {
          changes.push({ provider, model, pricing })
        }
      }
    })
  }
  return changes
}

function uniqueProviders(list: ProviderName[]): ProviderName[] {
  return Array.from(new Set(list))
}

interface PricingDraftState {
  baseline: PricingConfig | null
  defaults: PricingConfig | null
  draft: PricingConfig | null
  dirtyProviders: ProviderName[]
  pendingResetAll: boolean
  pendingProviderResets: ProviderName[]
  saving: boolean
  syncFromSnapshot: (pricing: PricingConfig | null, defaults: PricingConfig | null) => void
  updateModelPricing: (provider: ProviderName, model: string, pricing: ModelPricing) => void
  resetProviderToDefault: (provider: ProviderName) => void
  resetAllToDefaults: () => void
  discardDraft: () => void
  persistDraft: () => Promise<PricingConfig | null>
}

export const useSettingsPricingDraft = create<PricingDraftState>((set, get) => ({
  baseline: null,
  defaults: null,
  draft: null,
  dirtyProviders: [],
  pendingResetAll: false,
  pendingProviderResets: [],
  saving: false,
  syncFromSnapshot: (pricing, defaults) => {
    const state = get()
    if (!pricing) return
    if (state.dirtyProviders.length > 0 || state.saving) {
      // Avoid clobbering user edits; they can discard to re-sync manually
      return
    }
    const nextBaseline = cloneConfig(pricing)
    set({
      baseline: nextBaseline,
      draft: cloneConfig(pricing),
      defaults: cloneConfig(defaults ?? pricing),
      dirtyProviders: [],
      pendingResetAll: false,
      pendingProviderResets: [],
    })
  },
  updateModelPricing: (provider, model, pricing) => {
    set((state) => {
      if (!state.draft) return {}
      const nextDraft = cloneConfig(state.draft)
      nextDraft[provider] = {
        ...cloneProvider(nextDraft[provider]),
        [model]: pricing,
      }
      nextDraft.customRates = true
      const dirtyProviders = computeDirtyProviders(state.baseline, nextDraft)
      return {
        draft: nextDraft,
        dirtyProviders,
      }
    })
  },
  resetProviderToDefault: (provider) => {
    set((state) => {
      if (!state.draft) return {}
      const source = state.defaults ?? state.baseline
      if (!source) return {}
      const nextDraft = cloneConfig(state.draft)
      nextDraft[provider] = cloneProvider(source[provider])
      const dirtyProviders = computeDirtyProviders(state.baseline, nextDraft)
      const providerIsDirty = dirtyProviders.includes(provider)
      const pendingProviderResets = providerIsDirty
        ? uniqueProviders(state.pendingResetAll ? [] : [...state.pendingProviderResets, provider])
        : state.pendingProviderResets.filter((p) => p !== provider)
      return {
        draft: nextDraft,
        dirtyProviders,
        pendingProviderResets,
      }
    })
  },
  resetAllToDefaults: () => {
    set((state) => {
      const source = state.defaults ?? state.baseline
      if (!source) return {}
      const nextDraft = cloneConfig(source)
      const dirtyProviders = computeDirtyProviders(state.baseline, nextDraft)
      return {
        draft: nextDraft,
        dirtyProviders,
        pendingResetAll: dirtyProviders.length > 0,
        pendingProviderResets: [],
      }
    })
  },
  discardDraft: () => {
    const baseline = get().baseline
    if (!baseline) return
    set({
      draft: cloneConfig(baseline),
      dirtyProviders: [],
      pendingResetAll: false,
      pendingProviderResets: [],
    })
  },
  persistDraft: async () => {
    const client = getBackendClient()
    if (!client) {
      notifications.show({ color: 'red', title: 'Backend unavailable', message: 'Cannot save pricing without backend connection.' })
      return null
    }

    const state = get()
    if (!state.draft || !state.baseline) {
      notifications.show({ color: 'yellow', title: 'Pricing not ready', message: 'Load settings before saving pricing changes.' })
      return null
    }

    if (state.dirtyProviders.length === 0 && !state.pendingResetAll && state.pendingProviderResets.length === 0) {
      notifications.show({ color: 'gray', message: 'No pricing changes to save.' })
      return null
    }

    set({ saving: true })

    try {
      let workingBaseline = cloneConfig(state.baseline)

      if (state.pendingResetAll) {
        const res = await client.rpc('settings.resetPricingToDefaults', {})
        if (res?.ok && res.pricingConfig) {
          workingBaseline = cloneConfig(res.pricingConfig as PricingConfig)
        } else {
          workingBaseline = cloneConfig(state.defaults ?? workingBaseline)
        }
      } else {
        for (const provider of uniqueProviders(state.pendingProviderResets)) {
          await client.rpc('settings.resetProviderPricing', { provider })
          const defaults = state.defaults ?? state.baseline
          workingBaseline[provider] = cloneProvider(defaults?.[provider])
        }
      }

      const changes = diffPricing(workingBaseline, state.draft)
      for (const change of changes) {
        await client.rpc('settings.setPricingForModel', change)
      }

      const nextBaseline = cloneConfig(state.draft)
      set({
        baseline: nextBaseline,
        draft: cloneConfig(state.draft),
        dirtyProviders: [],
        pendingResetAll: false,
        pendingProviderResets: [],
        saving: false,
      })

      notifications.show({
        color: 'green',
        title: 'Pricing saved',
        message: changes.length === 0 ? 'Reset pricing to defaults.' : `Updated ${changes.length} model${changes.length === 1 ? '' : 's'}.`,
      })

      return nextBaseline
    } catch (err) {
      set({ saving: false })
      notifications.show({
        color: 'red',
        title: 'Failed to save pricing',
        message: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },
}))
