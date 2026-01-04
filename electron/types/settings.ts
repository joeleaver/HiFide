import type { ApiKeys, ModelOption, PricingConfig } from '../store/types'

export interface SettingsSnapshot {
  settingsApiKeys: ApiKeys
  settingsSaving: boolean
  settingsSaved: boolean
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ModelOption[]>
  defaultModels: Record<string, string | undefined>
  selectedProvider: string
  selectedModel: string
  fireworksAllowedModels: string[]
  openrouterAllowedModels: string[]
  startupMessage: string | null
  pricingConfig: PricingConfig
  defaultPricingConfig: PricingConfig
  vector?: {
    enabled: boolean
    provider: 'local' | 'openai'
    model: string
    localModel: string
  }
}

export type SettingsSnapshotResponse = SettingsSnapshot & { ok: true }
