/**
 * Workspace-scoped persistence for Explorer UI state.
 * Stores tree expansion state, last active file, etc.
 */

import { useBackendBinding } from '../binding'

const STORAGE_PREFIX = 'hifide:explorer:state:'
const GLOBAL_KEY = `${STORAGE_PREFIX}global`

export interface ExplorerPersistedState {
  expanded: string[]
  lastActiveFile?: string | null
  sidebarWidth?: number | null
  openFilesPaneHeight?: number | null
  sidebarMode?: 'workspace' | 'search'
  searchPaneHeight?: number | null
  searchPaneCollapsed?: boolean | null
  searchForm?: {
    query?: string
    replaceValue?: string
    matchCase?: boolean
    matchWholeWord?: boolean
    useRegex?: boolean
    includeGlobsText?: string
    excludeGlobsText?: string
    useIgnoreFiles?: boolean
    useGlobalIgnore?: boolean
  }
}

function getStorageKey(): string {
  const workspaceId = useBackendBinding.getState().workspaceId
  if (!workspaceId) return GLOBAL_KEY
  try {
    const hash = btoa(workspaceId).replace(/[^a-zA-Z0-9]/g, '')
    return `${STORAGE_PREFIX}${hash}`
  } catch {
    let hash = 0
    for (let i = 0; i < workspaceId.length; i += 1) {
      hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i)
      hash |= 0
    }
    return `${STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

function isSidebarMode(value: unknown): value is 'workspace' | 'search' {
  return value === 'workspace' || value === 'search'
}

export function loadExplorerState(): ExplorerPersistedState {
  if (typeof localStorage === 'undefined') return { expanded: [] }
  try {
    const raw = localStorage.getItem(getStorageKey())
    if (!raw) return { expanded: [] }
    const parsed = JSON.parse(raw) as ExplorerPersistedState
    return {
      expanded: Array.isArray(parsed?.expanded) ? parsed.expanded : [],
      lastActiveFile: typeof parsed?.lastActiveFile === 'string' ? parsed.lastActiveFile : null,
      sidebarWidth: typeof parsed?.sidebarWidth === 'number' ? parsed.sidebarWidth : null,
      openFilesPaneHeight: typeof parsed?.openFilesPaneHeight === 'number' ? parsed.openFilesPaneHeight : null,
      sidebarMode: isSidebarMode(parsed?.sidebarMode) ? parsed.sidebarMode : 'workspace',
      searchPaneHeight: typeof parsed?.searchPaneHeight === 'number' ? parsed.searchPaneHeight : null,
      searchPaneCollapsed: typeof parsed?.searchPaneCollapsed === 'boolean' ? parsed.searchPaneCollapsed : false,
      searchForm: typeof parsed?.searchForm === 'object' && parsed?.searchForm
        ? { ...parsed.searchForm }
        : undefined,
    }
  } catch (error) {
    console.warn('[explorerPersistence] Failed to load state', error)
    return { expanded: [] }
  }
}

export function saveExplorerState(partial: Partial<ExplorerPersistedState>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const existing = loadExplorerState()
    const next: ExplorerPersistedState = {
      expanded: partial.expanded ?? existing.expanded ?? [],
      lastActiveFile: partial.lastActiveFile ?? existing.lastActiveFile ?? null,
      sidebarWidth: partial.sidebarWidth ?? existing.sidebarWidth ?? null,
      openFilesPaneHeight: partial.openFilesPaneHeight ?? existing.openFilesPaneHeight ?? null,
      sidebarMode: isSidebarMode(partial.sidebarMode)
        ? partial.sidebarMode
        : existing.sidebarMode ?? 'workspace',
      searchPaneHeight: partial.searchPaneHeight ?? existing.searchPaneHeight ?? null,
      searchPaneCollapsed:
        typeof partial.searchPaneCollapsed === 'boolean'
          ? partial.searchPaneCollapsed
          : existing.searchPaneCollapsed ?? false,
      searchForm: partial.searchForm
        ? { ...existing.searchForm, ...partial.searchForm }
        : existing.searchForm,
    }
    localStorage.setItem(getStorageKey(), JSON.stringify(next))
  } catch (error) {
    console.warn('[explorerPersistence] Failed to save state', error)
  }
}

export function clearExplorerState(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(getStorageKey())
  } catch (error) {
    console.warn('[explorerPersistence] Failed to clear state', error)
  }
}
