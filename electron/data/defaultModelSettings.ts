import fs from 'node:fs'
import path from 'node:path'
import type { PricingConfig } from '../store/types.js'

export type ReasoningEffort = 'low' | 'medium' | 'high'

export type ModelDefaultSettings = {
  temperature?: number
  reasoningEffort?: ReasoningEffort
  includeThoughts?: boolean
  thinkingBudget?: number
}

export type ModelDefaultsConfig = Record<string, Record<string, ModelDefaultSettings>>

export type DefaultModelSettingsFileV1 = {
  version: 1
  pricing: PricingConfig
  modelDefaults: ModelDefaultsConfig
}

const SETTINGS_FILENAME = 'defaultModelSettings.json'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validatePricingConfig(value: unknown): value is PricingConfig {
  if (!isObject(value)) return false
  // best-effort structural checks (keep light to avoid brittleness)
  for (const k of ['openai', 'anthropic', 'gemini', 'fireworks', 'xai']) {
    if (!isObject((value as any)[k])) return false
  }
  if (typeof (value as any).customRates !== 'boolean') return false
  return true
}

function validateModelDefaultSettings(value: unknown): value is ModelDefaultSettings {
  if (!isObject(value)) return false
  if ('temperature' in value && value.temperature !== undefined && !isNumber(value.temperature)) return false
  if ('thinkingBudget' in value && value.thinkingBudget !== undefined && !isNumber(value.thinkingBudget)) return false
  if ('includeThoughts' in value && value.includeThoughts !== undefined && typeof value.includeThoughts !== 'boolean') {
    return false
  }
  if (
    'reasoningEffort' in value &&
    value.reasoningEffort !== undefined &&
    value.reasoningEffort !== 'low' &&
    value.reasoningEffort !== 'medium' &&
    value.reasoningEffort !== 'high'
  ) {
    return false
  }
  return true
}

function validateModelDefaultsConfig(value: unknown): value is ModelDefaultsConfig {
  if (!isObject(value)) return false
  for (const provider of Object.keys(value)) {
    const providerMap = (value as any)[provider]
    if (!isObject(providerMap)) return false
    for (const model of Object.keys(providerMap)) {
      if (!validateModelDefaultSettings(providerMap[model])) return false
    }
  }
  return true
}

export function getDefaultModelSettingsPath(): string {
  // When running from source (dev/test) `__dirname` is typically `electron/data`.
  // When bundled, `__dirname` may be `dist-electron` (or inside an asar).
  // We therefore search a couple of likely locations.
  const candidates = [
    // 1) Next to the compiled main bundle output (e.g. dist-electron/defaultModelSettings.json)
    path.resolve(__dirname, SETTINGS_FILENAME),
    // 2) In the source tree (e.g. electron/data/defaultModelSettings.json)
    path.resolve(__dirname, '..', 'data', SETTINGS_FILENAME),
    path.resolve(process.cwd(), 'electron', 'data', SETTINGS_FILENAME),
    // 3) In the packaged resources directory (typical electron-builder layout)
    ...(process.resourcesPath
      ? [path.resolve(process.resourcesPath, SETTINGS_FILENAME)]
      : []),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  // Fall back to the original expectation to preserve the path in the error message.
  return candidates[0]
}

let cached: DefaultModelSettingsFileV1 | null = null

export function loadDefaultModelSettingsFile(): DefaultModelSettingsFileV1 {
  if (cached) return cached

  const filePath = getDefaultModelSettingsPath()
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as unknown

  if (!isObject(parsed) || parsed.version !== 1) {
    throw new Error(`[defaultModelSettings] Invalid or missing version in ${filePath}`)
  }

  const pricing = (parsed as any).pricing
  const modelDefaults = (parsed as any).modelDefaults

  if (!validatePricingConfig(pricing)) {
    throw new Error(`[defaultModelSettings] Invalid pricing config in ${filePath}`)
  }

  if (!validateModelDefaultsConfig(modelDefaults)) {
    throw new Error(`[defaultModelSettings] Invalid modelDefaults config in ${filePath}`)
  }

  cached = { version: 1, pricing, modelDefaults }
  return cached
}

export function getDefaultPricingConfig(): PricingConfig {
  return loadDefaultModelSettingsFile().pricing
}

export function getDefaultModelOverrides(provider: string, model: string): ModelDefaultSettings | undefined {
  const { modelDefaults } = loadDefaultModelSettingsFile()
  return modelDefaults?.[provider]?.[model]
}
