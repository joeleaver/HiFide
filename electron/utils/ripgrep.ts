import path from 'node:path'
import { existsSync } from 'node:fs'

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
