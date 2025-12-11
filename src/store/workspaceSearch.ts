import { create } from 'zustand'
import { notifications } from '@mantine/notifications'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { loadExplorerState, saveExplorerState } from './utils/explorerPersistence'
import { normalizeFsPath } from './utils/fsPath'
import { useEditorStore } from './editor'
import {
  SEARCH_NOTIFICATION_DONE,
  SEARCH_NOTIFICATION_RESULTS,
  type WorkspaceSearchBatchPayload,
  type WorkspaceSearchDonePayload,
  type WorkspaceSearchMatch,
  type WorkspaceSearchParams,
  type WorkspaceReplaceMatch,
  type WorkspaceReplaceOperation,
} from '../../shared/search'

const DEFAULT_SEARCH_HEIGHT = 280
const MIN_SEARCH_HEIGHT = 140
const MAX_SEARCH_HEIGHT = 520

type FocusTarget = 'query' | 'replace'

interface WorkspaceSearchFileEntry {
  path: string
  relativePath: string
  matchIds: string[]
}

interface WorkspaceSearchStats {
  matchCount: number
  fileCount: number
  durationMs: number
  limitHit: boolean
}

export interface LocalSearchMatch extends WorkspaceSearchMatch {
  fileKey: string
  monacoRange: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

interface WorkspaceSearchState {
  query: string
  replaceValue: string
  matchCase: boolean
  matchWholeWord: boolean
  useRegex: boolean
  includeGlobsText: string
  excludeGlobsText: string
  useIgnoreFiles: boolean
  useGlobalIgnore: boolean
  searchPaneCollapsed: boolean
  searchPaneHeight: number
  searchId: string | null
  isSearching: boolean
  lastError: string | null
  stats: WorkspaceSearchStats | null
  startedAt: number | null
  resultsByFile: Record<string, WorkspaceSearchFileEntry>
  fileOrder: string[]
  matchesById: Record<string, LocalSearchMatch>
  selectedMatches: Record<string, boolean>
  expandedFiles: Record<string, boolean>
  focusTokens: { query: number; replace: number }
  hydrateFromPersistence: () => void
  resetForWorkspace: () => void
  setQuery: (value: string) => void
  setReplaceValue: (value: string) => void
  setIncludeGlobsText: (value: string) => void
  setExcludeGlobsText: (value: string) => void
  setMatchCase: (value: boolean) => void
  setMatchWholeWord: (value: boolean) => void
  setUseRegex: (value: boolean) => void
  setUseIgnoreFiles: (value: boolean) => void
  setUseGlobalIgnore: (value: boolean) => void
  setSearchPaneCollapsed: (collapsed: boolean) => void
  setSearchPaneHeight: (height: number) => void
  runSearch: () => Promise<void>
  cancelSearch: () => Promise<void>
  handleResults: (payload: WorkspaceSearchBatchPayload) => void
  handleDone: (payload: WorkspaceSearchDonePayload) => void
  requestFocus: (target: FocusTarget) => void
  toggleFileExpanded: (fileKey: string) => void
  toggleFileSelection: (fileKey: string, value?: boolean) => void
  toggleMatchSelection: (matchId: string, value?: boolean) => void
  selectAllMatches: (selected: boolean) => void
  openMatch: (matchId: string, opts?: { pinned?: boolean }) => Promise<void>
  applySelectedReplacements: () => Promise<void>
  replaceInFile: (fileKey: string) => Promise<void>
  clearResults: () => void
}

const persisted = loadExplorerState()
const initialSearchHeight = clampNumber(
  typeof persisted.searchPaneHeight === 'number' ? persisted.searchPaneHeight : DEFAULT_SEARCH_HEIGHT,
  MIN_SEARCH_HEIGHT,
  MAX_SEARCH_HEIGHT
)

export const useWorkspaceSearchStore = create<WorkspaceSearchState>((set, get) => ({
  query: persisted.searchForm?.query ?? '',
  replaceValue: persisted.searchForm?.replaceValue ?? '',
  matchCase: persisted.searchForm?.matchCase ?? false,
  matchWholeWord: persisted.searchForm?.matchWholeWord ?? false,
  useRegex: persisted.searchForm?.useRegex ?? false,
  includeGlobsText: persisted.searchForm?.includeGlobsText ?? '',
  excludeGlobsText: persisted.searchForm?.excludeGlobsText ?? '',
  useIgnoreFiles: persisted.searchForm?.useIgnoreFiles ?? true,
  useGlobalIgnore: persisted.searchForm?.useGlobalIgnore ?? true,
  searchPaneCollapsed: persisted.searchPaneCollapsed ?? false,
  searchPaneHeight: initialSearchHeight,
  searchId: null,
  isSearching: false,
  lastError: null,
  stats: null,
  startedAt: null,
  resultsByFile: {},
  fileOrder: [],
  matchesById: {},
  selectedMatches: {},
  expandedFiles: {},
  focusTokens: { query: 0, replace: 0 },

  hydrateFromPersistence: () => {
    const next = loadExplorerState()
    set((state) => ({
      query: next.searchForm?.query ?? state.query,
      replaceValue: next.searchForm?.replaceValue ?? state.replaceValue,
      matchCase: next.searchForm?.matchCase ?? state.matchCase,
      matchWholeWord: next.searchForm?.matchWholeWord ?? state.matchWholeWord,
      useRegex: next.searchForm?.useRegex ?? state.useRegex,
      includeGlobsText: next.searchForm?.includeGlobsText ?? state.includeGlobsText,
      excludeGlobsText: next.searchForm?.excludeGlobsText ?? state.excludeGlobsText,
      useIgnoreFiles: next.searchForm?.useIgnoreFiles ?? state.useIgnoreFiles,
      useGlobalIgnore: next.searchForm?.useGlobalIgnore ?? state.useGlobalIgnore,
      searchPaneCollapsed: next.searchPaneCollapsed ?? state.searchPaneCollapsed,
      searchPaneHeight: clampNumber(
        typeof next.searchPaneHeight === 'number' ? next.searchPaneHeight : state.searchPaneHeight,
        MIN_SEARCH_HEIGHT,
        MAX_SEARCH_HEIGHT
      ),
    }))
  },

  resetForWorkspace: () => {
    set({
      searchId: null,
      isSearching: false,
      lastError: null,
      stats: null,
      startedAt: null,
      resultsByFile: {},
      fileOrder: [],
      matchesById: {},
      selectedMatches: {},
      expandedFiles: {},
    })
  },

  setQuery: (value) => {
    set({ query: value })
    persistSearchFormFromState(get())
  },
  setReplaceValue: (value) => {
    set({ replaceValue: value })
    persistSearchFormFromState(get())
  },
  setIncludeGlobsText: (value) => {
    set({ includeGlobsText: value })
    persistSearchFormFromState(get())
  },
  setExcludeGlobsText: (value) => {
    set({ excludeGlobsText: value })
    persistSearchFormFromState(get())
  },
  setMatchCase: (value) => {
    set({ matchCase: value })
    persistSearchFormFromState(get())
  },
  setMatchWholeWord: (value) => {
    set({ matchWholeWord: value })
    persistSearchFormFromState(get())
  },
  setUseRegex: (value) => {
    set({ useRegex: value })
    persistSearchFormFromState(get())
  },
  setUseIgnoreFiles: (value) => {
    set({ useIgnoreFiles: value })
    persistSearchFormFromState(get())
  },
  setUseGlobalIgnore: (value) => {
    set({ useGlobalIgnore: value })
    persistSearchFormFromState(get())
  },
  setSearchPaneCollapsed: (collapsed) => {
    set({ searchPaneCollapsed: collapsed })
    saveExplorerState({ searchPaneCollapsed: collapsed })
  },
  setSearchPaneHeight: (height) => {
    const nextHeight = clampNumber(height, MIN_SEARCH_HEIGHT, MAX_SEARCH_HEIGHT)
    set({ searchPaneHeight: nextHeight })
    saveExplorerState({ searchPaneHeight: nextHeight })
  },

  runSearch: async () => {
    const state = get()
    const query = state.query.trim()
    if (!query) {
      set({ lastError: 'Enter a search term' })
      return
    }

    const client = getBackendClient()
    if (!client) {
      throw new Error('Backend not connected')
    }

    const params = buildSearchParams(state)

    set({
      isSearching: true,
      searchId: null,
      lastError: null,
      stats: null,
      startedAt: Date.now(),
      resultsByFile: {},
      fileOrder: [],
      matchesById: {},
      selectedMatches: {},
      expandedFiles: {},
    })

    try {
      const whenReady = (client as any).whenReady
      if (typeof whenReady === 'function') {
        await whenReady.call(client, 5000)
      }
    } catch {}

    try {
      const res: any = await client.rpc('search.workspace.run', { params })
      if (!res?.ok) {
        throw new Error(res?.error || 'Search failed')
      }
      set({ searchId: res.searchId ?? null })
    } catch (error: any) {
      set({ isSearching: false, searchId: null, lastError: error?.message || 'Search failed' })
      notifications.show({ color: 'red', title: 'Workspace search failed', message: error?.message || 'Unable to search workspace' })
    }
  },

  cancelSearch: async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      await client.rpc('search.workspace.cancel', {})
    } catch {}
    set({ isSearching: false, searchId: null })
  },

  handleResults: (payload) => {
    if (!payload || payload.searchId !== get().searchId) return
    set((state) => {
      const resultsByFile = { ...state.resultsByFile }
      const matchesById = { ...state.matchesById }
      const selectedMatches = { ...state.selectedMatches }
      const expandedFiles = { ...state.expandedFiles }
      const fileOrder = [...state.fileOrder]

      for (const file of payload.files) {
        const fileKey = normalizeFsPath(file.path) ?? file.path
        let entry = resultsByFile[fileKey]
        if (!entry) {
          entry = { path: file.path, relativePath: file.relativePath, matchIds: [] }
          resultsByFile[fileKey] = entry
          fileOrder.push(fileKey)
          if (fileOrder.length <= 5) {
            expandedFiles[fileKey] = true
          }
        }

        for (const match of file.matches) {
          const normalized: LocalSearchMatch = {
            ...match,
            fileKey,
            monacoRange: toMonacoRange(match),
          }
          entry.matchIds.push(match.id)
          matchesById[match.id] = normalized
          selectedMatches[match.id] = true
        }
      }

      return {
        resultsByFile,
        matchesById,
        selectedMatches,
        expandedFiles,
        fileOrder,
        stats: {
          matchCount: payload.matchCount,
          fileCount: payload.fileCount,
          durationMs: state.stats?.durationMs ?? 0,
          limitHit: state.stats?.limitHit ?? false,
        },
      }
    })
  },

  handleDone: (payload) => {
    if (!payload || payload.searchId !== get().searchId) return
    set({
      isSearching: false,
      searchId: null,
      stats: {
        matchCount: payload.matchCount,
        fileCount: payload.fileCount,
        durationMs: payload.durationMs,
        limitHit: payload.limitHit,
      },
      lastError: payload.error ?? null,
    })
    if (payload.error) {
      notifications.show({ color: 'red', title: 'Workspace search failed', message: payload.error })
    }
  },

  requestFocus: (target) => {
    set((state) => ({
      searchPaneCollapsed: false,
      focusTokens: {
        ...state.focusTokens,
        [target]: state.focusTokens[target] + 1,
      },
    }))
    saveExplorerState({ searchPaneCollapsed: false })
  },

  toggleFileExpanded: (fileKey) => {
    set((state) => ({
      expandedFiles: { ...state.expandedFiles, [fileKey]: !state.expandedFiles[fileKey] },
    }))
  },

  toggleFileSelection: (fileKey, value) => {
    set((state) => {
      const entry = state.resultsByFile[fileKey]
      if (!entry) return {}
      const next = typeof value === 'boolean' ? value : !entry.matchIds.every((id) => state.selectedMatches[id])
      const selectedMatches = { ...state.selectedMatches }
      for (const id of entry.matchIds) {
        selectedMatches[id] = next
      }
      return { selectedMatches }
    })
  },

  toggleMatchSelection: (matchId, value) => {
    set((state) => ({
      selectedMatches: {
        ...state.selectedMatches,
        [matchId]: typeof value === 'boolean' ? value : !state.selectedMatches[matchId],
      },
    }))
  },

  selectAllMatches: (selected) => {
    set((state) => {
      const selectedMatches: Record<string, boolean> = {}
      for (const id of Object.keys(state.matchesById)) {
        selectedMatches[id] = selected
      }
      return { selectedMatches }
    })
  },

  openMatch: async (matchId, opts) => {
    const match = get().matchesById[matchId]
    if (!match) return
    const editor = useEditorStore.getState()
    await editor.openFile(match.path, { mode: opts?.pinned ? 'pinned' : 'preview' })
    await editor.revealRangeInFile(match.path, match.monacoRange)
  },

  applySelectedReplacements: async () => {
    const state = get()
    const matches = Object.entries(state.selectedMatches)
      .filter(([, selected]) => selected)
      .map(([id]) => state.matchesById[id])
      .filter(Boolean) as LocalSearchMatch[]

    if (!matches.length) {
      notifications.show({ color: 'blue', title: 'Replace', message: 'Select at least one match to replace.' })
      return
    }

    await performReplacement(matches, state)
  },

  replaceInFile: async (fileKey) => {
    const state = get()
    const entry = state.resultsByFile[fileKey]
    if (!entry) return
    const matches = entry.matchIds.map((id) => state.matchesById[id]).filter(Boolean) as LocalSearchMatch[]
    if (!matches.length) return
    await performReplacement(matches, state)
  },

  clearResults: () => {
    set({
      resultsByFile: {},
      fileOrder: [],
      matchesById: {},
      selectedMatches: {},
      expandedFiles: {},
      stats: null,
      lastError: null,
    })
  },
}))

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseGlobInput(value: string): string[] {
  return value
    .split(/[\s,\n]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function toMonacoRange(match: WorkspaceSearchMatch) {
  const startLine = Math.max(1, match.range.start.line || 1)
  const endLine = Math.max(startLine, match.range.end.line || startLine)
  const startColumn = Math.max(1, match.range.start.column || 1)
  const endColumn = Math.max(startColumn + 1, match.range.end.column || startColumn + 1)
  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  }
}

function buildSearchParams(state: WorkspaceSearchState): WorkspaceSearchParams {
  return {
    query: state.query.trim(),
    replace: state.replaceValue,
    isRegex: state.useRegex,
    matchCase: state.matchCase,
    matchWholeWord: state.matchWholeWord,
    includeGlobs: parseGlobInput(state.includeGlobsText),
    excludeGlobs: parseGlobInput(state.excludeGlobsText),
    useIgnoreFiles: state.useIgnoreFiles,
    useGlobalIgnore: state.useGlobalIgnore,
  }
}

function persistSearchFormFromState(state: WorkspaceSearchState): void {
  saveExplorerState({
    searchForm: {
      query: state.query,
      replaceValue: state.replaceValue,
      matchCase: state.matchCase,
      matchWholeWord: state.matchWholeWord,
      useRegex: state.useRegex,
      includeGlobsText: state.includeGlobsText,
      excludeGlobsText: state.excludeGlobsText,
      useIgnoreFiles: state.useIgnoreFiles,
      useGlobalIgnore: state.useGlobalIgnore,
    },
  })
}

async function performReplacement(matches: LocalSearchMatch[], state: WorkspaceSearchState): Promise<void> {
  const client = getBackendClient()
  if (!client) return
  const operations = buildReplacementOperations(matches, state)
  if (!operations.length) {
    notifications.show({ color: 'blue', title: 'Replace', message: 'No eligible matches to replace.' })
    return
  }

  try {
    const res: any = await client.rpc('search.workspace.replace', { operations, searchId: state.searchId })
    if (!res?.ok) {
      throw new Error(res?.error || 'Replace failed')
    }
    const applied = res?.result?.replacementsApplied ?? matches.length
    notifications.show({ color: 'green', title: 'Replace complete', message: `Applied ${applied} replacement${applied === 1 ? '' : 's'}.` })
  } catch (error: any) {
    notifications.show({ color: 'red', title: 'Replace failed', message: error?.message || 'Unable to replace matches' })
    return
  }

  await useWorkspaceSearchStore.getState().runSearch()
}

function buildReplacementOperations(matches: LocalSearchMatch[], state: WorkspaceSearchState): WorkspaceReplaceOperation[] {
  if (!matches.length) return []
  const grouped = new Map<string, WorkspaceReplaceMatch[]>()
  for (const match of matches) {
    const entry = state.resultsByFile[match.fileKey]
    if (!entry) continue
    const replacement: WorkspaceReplaceMatch = {
      id: match.id,
      start: match.range.start,
      end: match.range.end,
      replacement: computeReplacementText(match, state),
    }
    if (!grouped.has(match.fileKey)) grouped.set(match.fileKey, [])
    grouped.get(match.fileKey)!.push(replacement)
  }

  const operations: WorkspaceReplaceOperation[] = []
  for (const [fileKey, replacements] of grouped.entries()) {
    const entry = state.resultsByFile[fileKey]
    if (!entry) continue
    operations.push({
      path: entry.relativePath || entry.path,
      matches: replacements,
    })
  }
  return operations
}

function computeReplacementText(match: LocalSearchMatch, state: WorkspaceSearchState): string {
  const template = state.replaceValue ?? ''
  if (!state.useRegex) {
    return template
  }
  try {
    const flags = state.matchCase ? '' : 'i'
    const regex = new RegExp(state.query, flags)
    return match.matchText.replace(regex, template)
  } catch {
    return template
  }
}

let eventsBound = false

export function initWorkspaceSearchEvents(): void {
  if (eventsBound) return
  const client = getBackendClient()
  if (!client) return

  client.subscribe(SEARCH_NOTIFICATION_RESULTS, (payload: WorkspaceSearchBatchPayload) => {
    useWorkspaceSearchStore.getState().handleResults(payload)
  })

  client.subscribe(SEARCH_NOTIFICATION_DONE, (payload: WorkspaceSearchDonePayload) => {
    useWorkspaceSearchStore.getState().handleDone(payload)
  })

  client.subscribe('workspace.attached', () => {
    useWorkspaceSearchStore.getState().resetForWorkspace()
  })

  eventsBound = true
}
