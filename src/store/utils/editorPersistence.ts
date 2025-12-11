import { useBackendBinding } from '../binding'

export type EditorViewPreference = 'rich' | 'source'

export interface EditorPersistedTabState {
  path: string
  viewMode?: EditorViewPreference
}

export interface EditorPersistedState {
  tabs: EditorPersistedTabState[]
  activePath: string | null
}

const STORAGE_PREFIX = 'hifide:editor:tabs:'
const GLOBAL_KEY = `${STORAGE_PREFIX}global`

function getWorkspaceKey(): string {
  const binding = useBackendBinding.getState()
  const workspaceId = binding.workspaceId
  if (!workspaceId) return GLOBAL_KEY

  try {
    const encoded = typeof btoa === 'function'
      ? btoa(workspaceId)
      : typeof Buffer !== 'undefined'
        ? Buffer.from(workspaceId, 'utf-8').toString('base64')
        : workspaceId
    return `${STORAGE_PREFIX}${encoded.replace(/[^a-zA-Z0-9]/g, '')}`
  } catch {
    let hash = 0
    for (let i = 0; i < workspaceId.length; i += 1) {
      hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i)
      hash |= 0
    }
    return `${STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

function sanitizeTabs(raw: unknown): EditorPersistedTabState[] {
  if (!Array.isArray(raw)) return []
  const tabs: EditorPersistedTabState[] = []
  for (const entry of raw) {
    const path = typeof (entry as any)?.path === 'string' ? (entry as any).path : null
    if (!path) continue
    const viewMode = (entry as any)?.viewMode
    const isValidView = viewMode === 'rich' || viewMode === 'source'
    tabs.push({ path, viewMode: isValidView ? viewMode : undefined })
  }
  return tabs
}

export function loadEditorState(): EditorPersistedState {
  if (typeof localStorage === 'undefined') {
    return { tabs: [], activePath: null }
  }

  try {
    const raw = localStorage.getItem(getWorkspaceKey())
    if (!raw) return { tabs: [], activePath: null }
    const parsed = JSON.parse(raw)
    const tabs = sanitizeTabs(parsed?.tabs)
    const activePath = typeof parsed?.activePath === 'string' ? parsed.activePath : null
    return { tabs, activePath }
  } catch (error) {
    console.warn('[editorPersistence] Failed to load state', error)
    return { tabs: [], activePath: null }
  }
}

export function saveEditorState(state: EditorPersistedState): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: EditorPersistedState = {
      tabs: sanitizeTabs(state?.tabs),
      activePath: typeof state?.activePath === 'string' ? state.activePath : null,
    }
    localStorage.setItem(getWorkspaceKey(), JSON.stringify(payload))
  } catch (error) {
    console.warn('[editorPersistence] Failed to save state', error)
  }
}

export function clearEditorState(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(getWorkspaceKey())
  } catch (error) {
    console.warn('[editorPersistence] Failed to clear state', error)
  }
}
