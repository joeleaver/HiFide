import path from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export type FileExistsPredicate = (targetPath: string) => boolean

/**
 * Convert ripgrep binary paths that point inside app.asar to their unpacked counterpart when present.
 * Electron cannot spawn executables from inside an asar archive, so we proactively rewrite the path
 * to app.asar.unpacked when the unpacked binary exists on disk.
 */
export function preferUnpackedRipgrepPath(rawPath: string, fileExists: FileExistsPredicate = existsSync): string {
  if (!rawPath) return rawPath

  const normalized = path.normalize(rawPath)
  if (!normalized.includes('app.asar')) return normalized
  if (normalized.includes('app.asar.unpacked')) return normalized

  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  if (unpacked !== normalized && fileExists(unpacked)) {
    return unpacked
  }

  return normalized
}

// Cache for system ripgrep path
let systemRipgrepPath: string | null | undefined = undefined

/**
 * Try to find ripgrep installed on the system (via PATH).
 * Returns the path if found, null if not available.
 */
export function findSystemRipgrep(): string | null {
  if (systemRipgrepPath !== undefined) return systemRipgrepPath

  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = spawnSync(cmd, ['rg'], { encoding: 'utf8', timeout: 5000 })

    if (result.status === 0 && result.stdout) {
      const rgPath = result.stdout.split('\n')[0].trim()
      if (rgPath && existsSync(rgPath)) {
        console.log('[ripgrep] Found system ripgrep:', rgPath)
        systemRipgrepPath = rgPath
        return rgPath
      }
    }
  } catch (e) {
    // Ignore errors, just means ripgrep is not in PATH
  }

  systemRipgrepPath = null
  return null
}
