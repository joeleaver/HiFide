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
  for (const k of ['openai', 'anthropic', 'gemini', 'fireworks', 'xai', 'openrouter']) {
    if (!isObject((value as any)[k])) return false
  }
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
  // Single source of truth rules:
  // - In dev/test: Prefer public/defaultModelSettings.json so edits are immediate.
  // - In production: Prefer the packaged location (typically dist/ or resources/).
  // - We use process.env.VITE_PUBLIC if set (by main.ts) as the primary hint.

  // 1. Check process.env.VITE_PUBLIC (set in main.ts to point to public/ in dev or dist/ in prod)
  if (process.env.VITE_PUBLIC) {
    const envPath = path.join(process.env.VITE_PUBLIC, SETTINGS_FILENAME)
    if (fs.existsSync(envPath)) return envPath
  }

  // 2. Fallback to process.resourcesPath (standard Electron packaged resources)
  // In a built app, files in 'public' are moved to the root of the renderer 'dist' folder.
  // If we are in ASAR, process.resourcesPath points to the directory containing app.asar.
  // The 'dist' folder (VITE_PUBLIC) inside app.asar is usually:
  // resources/app.asar/dist/defaultModelSettings.json
  const packagedPath = process.resourcesPath
    ? path.resolve(process.resourcesPath, 'app.asar', 'dist', SETTINGS_FILENAME)
    : null
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath

  const packagedPathAlt = process.resourcesPath
    ? path.resolve(process.resourcesPath, SETTINGS_FILENAME)
    : null
  if (packagedPathAlt && fs.existsSync(packagedPathAlt)) return packagedPathAlt

  // 3. Fallback to common dev locations relative to CWD
  const publicPath = path.resolve(process.cwd(), 'public', SETTINGS_FILENAME)
  if (fs.existsSync(publicPath)) return publicPath

  const distPath = path.resolve(process.cwd(), 'dist', SETTINGS_FILENAME)
  if (fs.existsSync(distPath)) return distPath

  // 4. Legacy location (for transition)
  const legacyPath = path.resolve(process.cwd(), 'electron', 'data', SETTINGS_FILENAME)
  if (fs.existsSync(legacyPath)) return legacyPath

  // If we can't find it anywhere, fail loudly with context.
  throw new Error(
    `[defaultModelSettings] Could not locate ${SETTINGS_FILENAME}. ` +
      `Looked in VITE_PUBLIC, resourcesPath, ./public, and ./dist. ` +
      `CWD: ${process.cwd()}, VITE_PUBLIC: ${process.env.VITE_PUBLIC ?? 'unset'}`
  )
}

let cached: DefaultModelSettingsFileV1 | null = null

export function clearDefaultModelSettingsCache(): void {
  cached = null
}

export function loadDefaultModelSettingsFile(): DefaultModelSettingsFileV1 {
  if (cached) return cached

  const filePath = getDefaultModelSettingsPath()
  console.log(`[defaultModelSettings] loading from: ${filePath}`)
  const raw = fs.readFileSync(filePath, 'utf-8')
  console.log(`[defaultModelSettings] bytes: ${Buffer.byteLength(raw, 'utf-8')}`)
  const parsed = JSON.parse(raw) as unknown

  if (!isObject(parsed) || parsed.version !== 1) {
    throw new Error(`[defaultModelSettings] Invalid or missing version in ${filePath}`)
  }

  if (typeof (parsed as any).customRates !== 'boolean') {
    throw new Error(`[defaultModelSettings] Invalid customRates (must be boolean) in ${filePath}`)
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
