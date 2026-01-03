import type { DiffAnnotationsStateV1 } from '../../../shared/sourceControlAnnotations'
import { getFromLocalStorage, setInLocalStorage } from './persistence'
import { useBackendBinding } from '../binding'

const STORAGE_PREFIX = 'hifide:source-control:annotations:v1:'

function getStorageKey(repoRoot: string): string {
  const workspaceId = useBackendBinding.getState().workspaceId ?? 'global'
  // Keep keys stable/safe: base64 when possible, fallback to numeric hash.
  const raw = `${workspaceId}::${repoRoot}`
  try {
    return `${STORAGE_PREFIX}${btoa(raw).replace(/[^a-zA-Z0-9]/g, '')}`
  } catch {
    let hash = 0
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i)
      hash = ((hash << 5) - hash) + c
      hash |= 0
    }
    return `${STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

const EMPTY: DiffAnnotationsStateV1 = { version: 1, annotations: [] }

export function loadSourceControlAnnotations(repoRoot: string): DiffAnnotationsStateV1 {
  return getFromLocalStorage<DiffAnnotationsStateV1>(getStorageKey(repoRoot), EMPTY)
}

export function saveSourceControlAnnotations(repoRoot: string, state: DiffAnnotationsStateV1): void {
  setInLocalStorage(getStorageKey(repoRoot), state)
}

