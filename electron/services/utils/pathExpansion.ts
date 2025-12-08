import path from 'node:path'
import { homedir } from 'node:os'

export interface PathExpansionOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export function expandPathPlaceholders(value: string, options: PathExpansionOptions = {}): string {
  if (!value) {
    return value
  }

  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir()

  let result = stripWrappingQuotes(value.trim())
  if (!result) {
    return result
  }

  result = replaceEnvSegments(result, env, platform)
  result = expandTilde(result, homeDir)
  result = normalizeForPlatform(result, platform)
  return result
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function expandTilde(value: string, homeDir: string): string {
  if (!value.startsWith('~')) {
    return value
  }
  const second = value[1]
  if (second && second !== '/' && second !== '\\') {
    return value
  }
  const remainder = value.slice(1).replace(/^[/\\]+/, '')
  if (!remainder) {
    return homeDir
  }
  return path.resolve(homeDir, remainder)
}

function replaceEnvSegments(value: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const lookup = platform === 'win32' ? createCaseInsensitiveEnvMap(env) : env

  const getValue = (key: string): string | undefined => {
    if (!key) return undefined
    if (platform === 'win32') {
      return (lookup as Record<string, string>)[key.toUpperCase()]
    }
    return lookup[key]
  }

  let result = value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const replacement = getValue(String(key).trim())
    return replacement ?? match
  })

  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, key) => {
    const replacement = getValue(key)
    return replacement ?? match
  })

  if (platform === 'win32') {
    result = result.replace(/%([^%]+)%/g, (match, rawKey) => {
      const replacement = getValue(String(rawKey).trim())
      return replacement ?? match
    })
  }

  return result
}

function createCaseInsensitiveEnvMap(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key.toUpperCase()] = value
    }
  }
  return result
}

function normalizeForPlatform(value: string, platform: NodeJS.Platform): string {
  if (!value) {
    return value
  }
  if (platform === 'win32') {
    return path.win32.normalize(value)
  }
  return path.posix.normalize(value)
}
