import type { StateCreator } from 'zustand'

import { getBackendClient } from '@/lib/backend/bootstrap'
import { useEditorStore } from '@/store/editor'
import { uriToFsPath } from '@/lib/fs/uri'

import { loadExplorerState, saveExplorerState } from '../utils/explorerPersistence'
import { getBasename, getParentFsPath, normalizeFsPath, pathsEqual, sortExplorerEntries } from '../utils/fsPath'
import type { ExplorerEntry, ExplorerFsEvent } from '../../../electron/store/types'
import type { GitStatusSnapshot, GitStatusCategory } from '../../../shared/git'
import type { LspDiagnosticsEvent } from '../../../shared/lsp'
import { clampOpenFilesPaneHeight, clampSidebarWidth, normalizeSidebarMode } from './sidebar'
import { buildExpandedMap, ensureRootExpanded, recomputeTreeSnapshot } from './treeSnapshot'
import type {
  DiagnosticMap,
  DirEntriesMap,
  ExplorerBaseSlice,
  ExplorerStore,
  FlagMap,
  GitDecoration,
} from './types'

const initialPersistedState = loadExplorerState()
const initialExpanded = ensureRootExpanded(buildExpandedMap(initialPersistedState.expanded), null)

export const createExplorerBaseSlice: StateCreator<ExplorerStore, [], [], ExplorerBaseSlice> = (set, get) => ({
  workspaceRoot: null,
  normalizedRoot: null,
  entriesByDir: {},
  loadedDirs: {},
  loadingDirs: {},
  expanded: initialExpanded,
  treeRows: [],
  rowMap: {},
  rowIndexById: {},
  gitStatusByPath: {},
  diagnosticSources: {},
  diagnosticsByPath: {},
  lastError: null,
  isHydrating: false,

  hydrate: async () => {
    if (get().isHydrating) return
    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    set({ isHydrating: true, lastError: null })
    try {
      const res: any = await client.rpc('explorer.getState', {})
      if (!res?.ok) throw new Error(res?.error || 'Failed to load explorer state')

      const workspaceRoot = typeof res.workspaceRoot === 'string' ? res.workspaceRoot : null
      if (!workspaceRoot) throw new Error('Workspace not attached')
      const normalizedRoot = normalizeFsPath(workspaceRoot)

      const children = mapChildrenByDir(res.childrenByDir || {})
      const loadedDirs = buildLoadedDirs(children)

      const persistedState = loadExplorerState()
      const serverExpanded = buildExpandedMap(Array.isArray(res.openFolders) ? res.openFolders : [])
      const mergedExpanded = ensureRootExpanded({ ...serverExpanded, ...buildExpandedMap(persistedState.expanded) }, normalizedRoot)

      set({
        workspaceRoot,
        normalizedRoot,
        entriesByDir: children,
        loadedDirs,
        expanded: mergedExpanded,
        sidebarWidth: clampSidebarWidth(persistedState.sidebarWidth),
        openFilesPaneHeight: clampOpenFilesPaneHeight(persistedState.openFilesPaneHeight),
        sidebarMode: normalizeSidebarMode(persistedState.sidebarMode),
      })
      persistExpanded(mergedExpanded)
      recomputeTreeSnapshot(set, get)

      if (normalizedRoot && !children[normalizedRoot]) {
        await get().refreshDirectory(workspaceRoot, { force: true })
      }
      void get().refreshGitStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load explorer'
      set({ lastError: message })
      throw error
    } finally {
      set({ isHydrating: false })
    }
  },

  refreshDirectory: async (dirPath?: string, opts?: { force?: boolean }) => {
    const targetPath = dirPath ?? get().workspaceRoot
    if (!targetPath) return

    const key = normalizeFsPath(targetPath)
    if (!key) return

    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    if (!opts?.force && (get().loadingDirs[key] || get().loadedDirs[key])) {
      return
    }

    set((state) => ({
      loadingDirs: { ...state.loadingDirs, [key]: true },
      lastError: null,
    }))
    recomputeTreeSnapshot(set, get)

    try {
      const res: any = await client.rpc('explorer.listDir', { path: targetPath })
      if (!res?.ok || !Array.isArray(res.entries)) {
        throw new Error(res?.error || 'Failed to list directory')
      }
      const entries = sortExplorerEntries((res.entries as ExplorerEntry[]).map((entry) => ({ ...entry })))
      set((state) => ({
        entriesByDir: { ...state.entriesByDir, [key]: entries },
        loadedDirs: { ...state.loadedDirs, [key]: true },
      }))
      recomputeTreeSnapshot(set, get)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load directory'
      set({ lastError: message })
      throw error
    } finally {
      set((state) => {
        const nextLoading = { ...state.loadingDirs }
        delete nextLoading[key]
        return { loadingDirs: nextLoading }
      })
      recomputeTreeSnapshot(set, get)
    }
  },

  expandDirectory: async (dirPath: string, opts?: { force?: boolean }) => {
    const key = normalizeFsPath(dirPath)
    if (!key) return

    if (!get().expanded[key]) {
      set((state) => {
        const next = { ...state.expanded, [key]: true }
        persistExpanded(next)
        return { expanded: next }
      })
      recomputeTreeSnapshot(set, get)
    }

    if (!get().loadedDirs[key] || opts?.force) {
      await get().refreshDirectory(dirPath, { force: opts?.force })
    }
  },

  collapseDirectory: (dirPath: string) => {
    const key = normalizeFsPath(dirPath)
    if (!key) return
    if (!get().expanded[key]) return

    set((state) => {
      const next = pruneExpanded(state.expanded, key)
      persistExpanded(next)
      return { expanded: next }
    })
    recomputeTreeSnapshot(set, get)
  },

  toggleDirectory: async (dirPath: string) => {
    const key = normalizeFsPath(dirPath)
    if (!key) return
    if (get().expanded[key]) {
      get().collapseDirectory(dirPath)
    } else {
      await get().expandDirectory(dirPath)
    }
  },

  handleFsEvent: (event: ExplorerFsEvent) => {
    const updates = handleFsEventReducer(get(), event)
    if (Object.keys(updates).length) {
      set(updates)
      recomputeTreeSnapshot(set, get)
    }
  },

  openFileInEditor: async (filePath: string, opts) => {
    try {
      await useEditorStore.getState().openFile(filePath, { mode: opts?.mode ?? 'preview' })
      set({ lastError: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open file'
      set({ lastError: message })
      throw error
    }
  },

  resetForWorkspace: (workspaceRoot: string | null) => {
    const normalizedRoot = normalizeFsPath(workspaceRoot)
    const persistedState = loadExplorerState()
    const expanded = ensureRootExpanded(buildExpandedMap(persistedState.expanded), normalizedRoot)
    get().resetSelectionState()
    get().clearClipboardState()
    get().hideContextMenu()
    set({
      workspaceRoot,
      normalizedRoot,
      entriesByDir: {},
      loadedDirs: {},
      loadingDirs: {},
      expanded,
      treeRows: [],
      rowMap: {},
      rowIndexById: {},
      gitStatusByPath: {},
      diagnosticSources: {},
      diagnosticsByPath: {},
      lastError: null,
    })
    recomputeTreeSnapshot(set, get)
  },

  reloadPersistedState: () => {
    const persistedState = loadExplorerState()
    set((state) => ({
      expanded: ensureRootExpanded(buildExpandedMap(persistedState.expanded), state.normalizedRoot),
      sidebarWidth: clampSidebarWidth(persistedState.sidebarWidth),
      openFilesPaneHeight: clampOpenFilesPaneHeight(persistedState.openFilesPaneHeight),
      sidebarMode: normalizeSidebarMode(persistedState.sidebarMode),
    }))
    recomputeTreeSnapshot(set, get)
  },

  refreshGitStatus: async () => {
    const root = get().workspaceRoot
    if (!root) return
    const client = getBackendClient()
    if (!client) return
    try {
      const res: any = await client.rpc('git.getStatus', {})
      if (res?.ok && res.snapshot) {
        get().applyGitStatusSnapshot(res.snapshot as GitStatusSnapshot)
      }
    } catch (error) {
      console.warn('[explorer] Failed to refresh git status', error)
    }
  },

  applyGitStatusSnapshot: (snapshot: GitStatusSnapshot) => {
    if (!snapshot?.workspaceRoot) return
    const normalizedRoot = get().normalizedRoot
    if (!normalizedRoot || !pathsEqual(normalizedRoot, snapshot.workspaceRoot)) return
    if (!snapshot.isRepo) {
      set({ gitStatusByPath: {} })
      recomputeTreeSnapshot(set, get)
      return
    }
    const decorations = buildGitDecorationMap(snapshot, normalizedRoot)
    set({ gitStatusByPath: decorations })
    recomputeTreeSnapshot(set, get)
  },

  applyDiagnosticsFromLsp: (payload: LspDiagnosticsEvent) => {
    if (!payload?.uri) return
    const normalizedRoot = get().normalizedRoot
    if (payload.workspaceRoot && normalizedRoot && !pathsEqual(normalizedRoot, payload.workspaceRoot)) {
      return
    }
    const fsPath = uriToFsPath(payload.uri)
    const normalizedPath = normalizeFsPath(fsPath)
    if (!normalizedPath) return
    const severity = determineHighestSeverity(payload)
    set((state) => {
      const sources: DiagnosticMap = { ...state.diagnosticSources }
      if (!severity) {
        delete sources[normalizedPath]
      } else {
        sources[normalizedPath] = severity
      }
      const aggregated = buildDiagnosticAggregation(sources, state.normalizedRoot)
      return { diagnosticSources: sources, diagnosticsByPath: aggregated }
    })
    recomputeTreeSnapshot(set, get)
  },
})

function mapChildrenByDir(children: Record<string, ExplorerEntry[]>): DirEntriesMap {
  const mapped: DirEntriesMap = {}
  for (const [dirPath, entries] of Object.entries(children)) {
    const key = normalizeFsPath(dirPath)
    if (!key) continue
    mapped[key] = sortExplorerEntries((entries || []).map((entry) => ({ ...entry })))
  }
  return mapped
}

function cloneEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return entries.map((entry) => ({ ...entry }))
}

function buildLoadedDirs(children: DirEntriesMap): FlagMap {
  const loaded: FlagMap = {}
  for (const key of Object.keys(children)) {
    loaded[key] = true
  }
  return loaded
}

function pruneExpanded(expanded: FlagMap, parentKey: string): FlagMap {
  const next: FlagMap = {}
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`
  for (const [key, value] of Object.entries(expanded)) {
    if (key === parentKey) continue
    if (key.startsWith(prefix)) continue
    next[key] = value
  }
  return next
}

function persistExpanded(map: FlagMap): void {
  const expanded = Object.keys(map).filter((key) => map[key])
  saveExplorerState({ expanded })
}

function fsEventToEntry(event: ExplorerFsEvent): ExplorerEntry {
  return {
    name: getBasename(event.path) || event.relativePath?.split('/').pop() || event.path,
    isDirectory: event.isDirectory,
    path: event.path,
    relativePath: event.relativePath,
    size: event.size,
    mtimeMs: event.mtimeMs ?? Date.now(),
  }
}

function handleFsEventReducer(state: ExplorerStore, event: ExplorerFsEvent): Partial<ExplorerStore> {
  if (!state.normalizedRoot || !pathsEqual(state.normalizedRoot, event.workspaceRoot)) {
    return {}
  }

  const targetKey = normalizeFsPath(event.path)
  if (!targetKey) return {}

  let entriesByDir = state.entriesByDir
  let expanded = state.expanded
  let loadedDirs = state.loadedDirs
  let changed = false

  const parentKey = getParentFsPath(targetKey)
  if (parentKey && state.entriesByDir[parentKey]) {
    const parentEntries = cloneEntries(state.entriesByDir[parentKey])
    const existingIndex = parentEntries.findIndex((entry) => pathsEqual(entry.path, event.path))

    if (event.kind === 'file-added' || event.kind === 'dir-added') {
      const nextEntry = fsEventToEntry(event)
      if (existingIndex >= 0) {
        parentEntries[existingIndex] = nextEntry
      } else {
        parentEntries.push(nextEntry)
      }
      entriesByDir = { ...entriesByDir, [parentKey]: sortExplorerEntries(parentEntries) }
      changed = true
    } else if (event.kind === 'file-updated') {
      if (existingIndex >= 0) {
        parentEntries[existingIndex] = {
          ...parentEntries[existingIndex],
          size: event.size ?? parentEntries[existingIndex].size,
          mtimeMs: event.mtimeMs ?? Date.now(),
        }
        entriesByDir = { ...entriesByDir, [parentKey]: parentEntries }
        changed = true
      }
    } else if (event.kind === 'file-removed' || event.kind === 'dir-removed') {
      if (existingIndex >= 0) {
        parentEntries.splice(existingIndex, 1)
        entriesByDir = { ...entriesByDir, [parentKey]: parentEntries }
        changed = true
      }
    }
  }

  if (event.kind === 'dir-removed') {
    if (entriesByDir[targetKey]) {
      const clone = { ...entriesByDir }
      delete clone[targetKey]
      entriesByDir = clone
      changed = true
    }
    if (expanded[targetKey]) {
      expanded = pruneExpanded(expanded, targetKey)
      persistExpanded(expanded)
    }
    if (loadedDirs[targetKey]) {
      const nextLoaded = { ...loadedDirs }
      delete nextLoaded[targetKey]
      loadedDirs = nextLoaded
    }
  }

  if (!changed && expanded === state.expanded && loadedDirs === state.loadedDirs) {
    return {}
  }

  const updates: Partial<ExplorerStore> = {}
  if (changed || entriesByDir !== state.entriesByDir) updates.entriesByDir = entriesByDir
  if (expanded !== state.expanded) updates.expanded = expanded
  if (loadedDirs !== state.loadedDirs) updates.loadedDirs = loadedDirs

  return updates
}

const GIT_STATUS_RANK: Record<GitStatusCategory, number> = {
  conflict: 6,
  deleted: 5,
  renamed: 4,
  modified: 3,
  added: 3,
  untracked: 2,
  ignored: 1,
  clean: 0,
}

function buildGitDecorationMap(snapshot: GitStatusSnapshot, normalizedRoot: string | null): Record<string, GitDecoration> {
  const map: Record<string, GitDecoration> = {}
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : []
  for (const entry of entries) {
    const normalizedPath = normalizeFsPath(entry.path)
    if (!normalizedPath) continue
    map[normalizedPath] = mergeGitDecorations(map[normalizedPath], {
      category: entry.category,
      staged: !!entry.staged,
      unstaged: !!entry.unstaged,
    })

    let parent = getParentFsPath(normalizedPath)
    while (parent) {
      map[parent] = mergeGitDecorations(map[parent], {
        category: entry.category,
        staged: !!entry.staged,
        unstaged: !!entry.unstaged,
      })
      if (normalizedRoot && pathsEqual(parent, normalizedRoot)) break
      parent = getParentFsPath(parent)
    }
  }
  return map
}

function mergeGitDecorations(existing: GitDecoration | undefined, incoming: GitDecoration): GitDecoration {
  if (!existing) return incoming
  const currentRank = GIT_STATUS_RANK[existing.category] ?? 0
  const nextRank = GIT_STATUS_RANK[incoming.category] ?? 0
  if (nextRank > currentRank) {
    return {
      category: incoming.category,
      staged: existing.staged || incoming.staged,
      unstaged: existing.unstaged || incoming.unstaged,
    }
  }
  return {
    category: existing.category,
    staged: existing.staged || incoming.staged,
    unstaged: existing.unstaged || incoming.unstaged,
  }
}

function determineHighestSeverity(payload: LspDiagnosticsEvent): number | null {
  if (!Array.isArray(payload?.diagnostics) || payload.diagnostics.length === 0) {
    return null
  }
  let severity: number | null = null
  for (const diagnostic of payload.diagnostics) {
    const current = typeof diagnostic?.severity === 'number' ? diagnostic.severity : null
    if (!current) continue
    if (severity === null || current < severity) {
      severity = current
    }
  }
  return severity
}

function buildDiagnosticAggregation(sources: DiagnosticMap, normalizedRoot: string | null): DiagnosticMap {
  const aggregate: DiagnosticMap = {}
  for (const [pathKey, severity] of Object.entries(sources)) {
    aggregate[pathKey] = severity
    let parent = getParentFsPath(pathKey)
    while (parent) {
      const existing = aggregate[parent]
      if (existing == null || severity < existing) {
        aggregate[parent] = severity
      } else {
        break
      }
      if (normalizedRoot && pathsEqual(parent, normalizedRoot)) break
      parent = getParentFsPath(parent)
    }
  }
  return aggregate
}
