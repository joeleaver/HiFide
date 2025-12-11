import type { ExplorerEntry } from '../../../electron/store/types'

const WINDOWS_ROOT_REGEX = /^[a-zA-Z]:\/$/
const DRIVE_LETTER_REGEX = /^[a-zA-Z]:$/

export function normalizeFsPath(value?: string | null): string | null {
  if (!value) return null
  let normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/')

  if (DRIVE_LETTER_REGEX.test(normalized)) {
    normalized = `${normalized}/`
  }

  if (normalized.length > 1 && normalized.endsWith('/')) {
    if (normalized === '/' || WINDOWS_ROOT_REGEX.test(normalized)) {
      // Keep trailing slash for root paths
    } else {
      normalized = normalized.replace(/\/+$/g, '')
    }
  }

  return normalized
}

export function pathsEqual(a?: string | null, b?: string | null): boolean {
  const na = normalizeFsPath(a)
  const nb = normalizeFsPath(b)
  return !!na && !!nb && na === nb
}

export function getParentFsPath(value?: string | null): string | null {
  const normalized = normalizeFsPath(value)
  if (!normalized) return null
  if (normalized === '/' || WINDOWS_ROOT_REGEX.test(normalized)) return normalized

  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return normalized

  let parent = normalized.slice(0, idx)
  if (DRIVE_LETTER_REGEX.test(parent)) {
    parent = `${parent}/`
  }
  return parent || '/'
}

export function getBasename(value?: string | null): string {
  const normalized = normalizeFsPath(value)
  if (!normalized) return ''
  if (normalized === '/' || WINDOWS_ROOT_REGEX.test(normalized)) return normalized

  const idx = normalized.lastIndexOf('/')
  if (idx === -1) return normalized
  return normalized.slice(idx + 1)
}

export function sortExplorerEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
