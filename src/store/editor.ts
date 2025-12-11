import { create } from 'zustand'
import type { ExplorerFsEvent, OpenedFile } from '../../electron/store/types'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { getBasename, normalizeFsPath, pathsEqual } from './utils/fsPath'
import { loadEditorState, saveEditorState, type EditorViewPreference } from './utils/editorPersistence'
import { buildEditorPersistenceState } from './utils/editorSnapshot'
import { shouldReloadTabFromEvent } from './utils/editorConflict'
import { nextMarkdownCanonicalizationExpiry, shouldCanonicalizeMarkdownChange } from './utils/markdownCanonicalization'
import { URI } from 'vscode-uri'
import { openDocument as openLspDocument, changeDocument as changeLspDocument, closeDocument as closeLspDocument } from '@/lib/lsp/client'
import { detectLanguageFromPath } from '../../shared/language'

export type EditorViewMode = EditorViewPreference

export interface EditorTab {
  id: string
  path: string
  uri: string
  name: string
  language: string
  encoding: string
  content: string
  savedContent: string
  size?: number
  mtimeMs?: number
  isDirty: boolean
  isMarkdown: boolean
  viewMode: EditorViewMode
  isPreview: boolean
  lastLoadedAt: number
  version: number
  isUntitled: boolean
  untitledId?: string
  markdownCanonicalizationExpiry?: number
}

export interface EditorSelectionRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

interface EditorStore {
  workspaceRoot: string | null
  tabs: EditorTab[]
  activeTabId: string | null
  previewTabId: string | null
  lastError: string | null
  isSaving: boolean
  isHydrating: boolean
  nextUntitledId: number
  pendingReveals: Record<string, EditorSelectionRange | undefined>
 
  openFile: (path: string, opts?: { activate?: boolean; viewMode?: EditorViewMode; mode?: 'preview' | 'pinned' }) => Promise<void>
  createUntitledTab: () => void
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  setActiveTab: (tabId: string | null) => void
  updateContent: (tabId: string, content: string) => void
  saveTab: (tabId: string) => Promise<void>
  saveActiveTab: () => Promise<void>
  saveTabAs: (tabId: string) => Promise<void>
  saveActiveTabAs: () => Promise<void>
  reloadTabFromDisk: (tabId: string) => Promise<void>
  handleFsEvent: (event: ExplorerFsEvent) => void
  toggleMarkdownView: (tabId: string, mode?: EditorViewMode) => void
  resetForWorkspace: (workspaceRoot: string | null) => void
  hydrateFromPersistence: () => Promise<void>
  revealRangeInFile: (path: string, range: EditorSelectionRange) => void
  consumePendingReveal: (tabId: string) => EditorSelectionRange | null
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx'])
const UNTITLED_ID_PREFIX = 'untitled-'
const UNTITLED_URI_PREFIX = 'inmemory://untitled/'
const UNTITLED_SENTINEL = '__untitled__'

const inflightReloads = new Map<string, Promise<void>>()

function isMarkdownFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return false
  const ext = filePath.slice(dotIndex + 1).toLowerCase()
  return MARKDOWN_EXTENSIONS.has(ext)
}

function toModelUri(filePath: string): string {
  try {
    return URI.file(filePath).toString()
  } catch {
    return filePath
  }
}


function resolveLspLanguage(path: string, baseLanguage: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx')) return 'typescriptreact'
  if (lower.endsWith('.jsx')) return 'javascriptreact'
  return baseLanguage
}


function buildUntitledTab(index: number): EditorTab {
  const untitledId = `${UNTITLED_ID_PREFIX}${index}`
  const name = `Untitled-${index}`
  const path = untitledId
  return {
    id: untitledId,
    path,
    uri: `${UNTITLED_URI_PREFIX}${untitledId}`,
    name,
    language: 'plaintext',
    encoding: 'utf-8',
    content: '',
    savedContent: UNTITLED_SENTINEL,
    size: undefined,
    mtimeMs: undefined,
    isDirty: true,
    isMarkdown: false,
    viewMode: 'source',
    isPreview: false,
    lastLoadedAt: Date.now(),
    version: 1,
    isUntitled: true,
    untitledId,
    markdownCanonicalizationExpiry: undefined,
  }
}

function createTabFromFile(
  file: OpenedFile,
  existing: EditorTab | undefined,
  forcedViewMode?: EditorViewMode
): EditorTab {
  const tabId = normalizeFsPath(file.path)
  if (!tabId) {
    throw new Error('Invalid file path for editor tab')
  }
  const isMarkdown = isMarkdownFile(file.path)
  const resolvedViewMode = existing?.viewMode ?? forcedViewMode ?? (isMarkdown ? 'rich' : 'source')
  return {
    id: tabId,
    path: file.path,
    uri: existing?.uri ?? toModelUri(file.path),
    name: getBasename(file.path) || file.relativePath || file.path,
    language: file.language || 'plaintext',
    encoding: file.encoding || 'utf-8',
    content: file.content,
    savedContent: file.content,
    size: file.size,
    mtimeMs: file.mtimeMs,
    isDirty: false,
    isMarkdown,
    viewMode: resolvedViewMode,
    isPreview: existing?.isPreview ?? false,
    lastLoadedAt: Date.now(),
    version: existing?.version ?? 1,
    isUntitled: false,
    untitledId: undefined,
    markdownCanonicalizationExpiry: isMarkdown ? nextMarkdownCanonicalizationExpiry() : undefined,
  }
}

function persistTabsSnapshot(tabs: EditorTab[], activeTabId: string | null): void {
  const payload = buildEditorPersistenceState(
    tabs.map((tab) => ({
      id: tab.id,
      path: tab.path,
      viewMode: tab.viewMode,
      isPreview: tab.isPreview,
      isUntitled: tab.isUntitled,
    })),
    activeTabId
  )
  saveEditorState(payload)
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  workspaceRoot: null,
  tabs: [],
  activeTabId: null,
  previewTabId: null,
  lastError: null,
  isSaving: false,
  isHydrating: false,
  nextUntitledId: 1,
  pendingReveals: {},

  openFile: async (path, opts) => {
    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    const requestedMode = opts?.mode ?? 'preview'

    try {
      const res: any = await client.rpc('explorer.readFile', { path })
      if (!res?.ok || !res.file) throw new Error(res?.error || 'Failed to read file')
      const file = res.file as OpenedFile
      const normalizedId = normalizeFsPath(file.path)
      if (!normalizedId) throw new Error('Failed to normalize file path')
      const existing = get().tabs.find((tab) => tab.id === normalizedId)
      const baseTab = createTabFromFile(file, existing, opts?.viewMode)
      const wasExisting = !!existing
      const nextTab: EditorTab = {
        ...baseTab,
        isPreview: existing ? (requestedMode === 'pinned' ? false : existing.isPreview) : requestedMode === 'preview',
      }

      let tabPathToClose: string | null = null
      set((state) => {
        const nextTabs = state.tabs.slice()
        let previewTabId = state.previewTabId
        const existingIndex = nextTabs.findIndex((tab) => tab.id === nextTab.id)
        if (existingIndex >= 0) {
          const merged: EditorTab = {
            ...nextTabs[existingIndex],
            ...nextTab,
            viewMode: nextTabs[existingIndex].viewMode ?? nextTab.viewMode,
          }
          if (requestedMode === 'pinned' || merged.isDirty) {
            merged.isPreview = false
          }
          nextTabs[existingIndex] = merged
          if (!merged.isPreview && previewTabId === merged.id) {
            previewTabId = null
          } else if (merged.isPreview) {
            previewTabId = merged.id
          }
        } else {
          if (nextTab.isPreview) {
            if (previewTabId && previewTabId !== nextTab.id) {
              const previewIndex = nextTabs.findIndex((tab) => tab.id === previewTabId)
              if (previewIndex >= 0 && nextTabs[previewIndex].isPreview && !nextTabs[previewIndex].isDirty) {
                tabPathToClose = nextTabs[previewIndex].path
                nextTabs.splice(previewIndex, 1)
              }
            }
            previewTabId = nextTab.id
          } else if (previewTabId === nextTab.id) {
            previewTabId = null
          }
          nextTabs.push(nextTab)
        }

        const shouldActivate = opts?.activate !== false
        return {
          tabs: nextTabs,
          activeTabId: shouldActivate ? nextTab.id : state.activeTabId ?? null,
          lastError: null,
          previewTabId,
        }
      })

      persistTabsSnapshot(get().tabs, get().activeTabId)
      if (tabPathToClose) {
        void closeLspDocument(tabPathToClose)
      }

      void (async () => {
        try {
          const languageId = resolveLspLanguage(nextTab.path, nextTab.language)
          if (wasExisting) {
            await changeLspDocument({
              path: nextTab.path,
              languageId,
              text: nextTab.content,
              version: nextTab.version,
            })
          } else {
            await openLspDocument({
              path: nextTab.path,
              languageId,
              text: nextTab.content,
              version: nextTab.version,
            })
          }
        } catch (error) {
          console.warn('[editorStore] Failed to sync LSP document', error)
        }
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open file'
      set({ lastError: message })
      throw error
    }
  },
 
  createUntitledTab: () => {
    if (!get().workspaceRoot) {
      const error = new Error('workspace-required')
      set({ lastError: 'Open a workspace before creating files' })
      throw error
    }
 
    set((state) => {
      const newTab = buildUntitledTab(state.nextUntitledId)
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        previewTabId: state.previewTabId === newTab.id ? null : state.previewTabId,
        lastError: null,
        nextUntitledId: state.nextUntitledId + 1,
      }
    })
 
    persistTabsSnapshot(get().tabs, get().activeTabId)
  },
 
  closeTab: (tabId) => {
    if (!tabId) return
    const closingTab = get().tabs.find((tab) => tab.id === tabId)
    set((state) => {
      const filtered = state.tabs.filter((tab) => tab.id !== tabId)
      const wasActive = state.activeTabId === tabId
      const wasPreview = state.previewTabId === tabId
      const nextPending = { ...state.pendingReveals }
      delete nextPending[tabId]
      return {
        tabs: filtered,
        activeTabId: wasActive ? (filtered.length ? filtered[filtered.length - 1].id : null) : state.activeTabId,
        previewTabId: wasPreview ? null : state.previewTabId,
        pendingReveals: nextPending,
      }
    })
    persistTabsSnapshot(get().tabs, get().activeTabId)
    if (closingTab && !closingTab.isUntitled) {
      void closeLspDocument(closingTab.path)
    }
  },

  closeOtherTabs: (tabId) => {
    const tabsToClose = get().tabs.filter((tab) => tab.id !== tabId)
    set((state) => {
      const targetIndex = state.tabs.findIndex((tab) => tab.id === tabId)
      if (targetIndex === -1) return {}
      const targetTab = state.tabs[targetIndex]
      const keptTab = targetTab.isPreview ? { ...targetTab, isPreview: false } : targetTab
      return {
        tabs: [keptTab],
        activeTabId: tabId,
        previewTabId: null,
      }
    })
    persistTabsSnapshot(get().tabs, get().activeTabId)
    tabsToClose.forEach((tab) => {
      void closeLspDocument(tab.path)
    })
  },

  closeAllTabs: () => {
    const closing = get().tabs.slice()
    set({ tabs: [], activeTabId: null, previewTabId: null })
    persistTabsSnapshot([], null)
    closing.forEach((tab) => {
      void closeLspDocument(tab.path)
    })
  },

  setActiveTab: (tabId) => {
    set((state) => {
      if (tabId && !state.tabs.some((tab) => tab.id === tabId)) {
        return {}
      }
      return { activeTabId: tabId }
    })
    persistTabsSnapshot(get().tabs, get().activeTabId)
  },

  updateContent: (tabId, content) => {
    let didUpdate = false
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return {}
      const tab = state.tabs[index]
      if (tab.content === content) return {}
      const nextTabs = state.tabs.slice()
      const nextVersion = tab.version + 1
      const now = Date.now()
      const canonicalizing = shouldCanonicalizeMarkdownChange(tab, now)
      const nextTab: EditorTab = {
        ...tab,
        content,
        isDirty: canonicalizing ? false : content !== tab.savedContent,
        version: nextVersion,
        markdownCanonicalizationExpiry: undefined,
      }
      if (canonicalizing) {
        nextTab.savedContent = content
      }
      let previewTabId = state.previewTabId
      if (nextTab.isPreview && nextTab.isDirty) {
        nextTab.isPreview = false
        if (previewTabId === nextTab.id) {
          previewTabId = null
        }
      }
      nextTabs[index] = nextTab
      didUpdate = true
      return { tabs: nextTabs, previewTabId }
    })

    if (didUpdate) {
      const latest = get().tabs.find((tab) => tab.id === tabId)
      if (latest && !latest.isUntitled) {
        void changeLspDocument({
          path: latest.path,
          languageId: resolveLspLanguage(latest.path, latest.language),
          text: latest.content,
          version: latest.version,
        })
      }
    }
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.isUntitled) {
      await get().saveTabAs(tabId)
      return
    }
    if (!tab.isDirty) return

    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    set({ isSaving: true, lastError: null })
    try {
      const res: any = await client.rpc('editor.saveFile', {
        path: tab.path,
        content: tab.content,
        encoding: tab.encoding,
      })
      if (!res?.ok) throw new Error(res?.error || 'Failed to save file')
      set((state) => {
        const nextTabs = state.tabs.map((existing) => {
          if (existing.id !== tabId) return existing
          return {
            ...existing,
            savedContent: tab.content,
            content: tab.content,
            isDirty: false,
            size: res?.saved?.size ?? existing.size,
            mtimeMs: res?.saved?.mtimeMs ?? Date.now(),
          }
        })
        return { tabs: nextTabs, isSaving: false }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file'
      set({ isSaving: false, lastError: message })
      throw error
    }
  },

  saveActiveTab: async () => {
    const activeId = get().activeTabId
    if (!activeId) return
    await get().saveTab(activeId)
  },

  saveTabAs: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return

    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    set({ isSaving: true, lastError: null })
    try {
      const dialogRes: any = await client.rpc('workspace.saveFileDialog', {
        defaultPath: tab.isUntitled ? get().workspaceRoot ?? undefined : tab.path,
        suggestedName: tab.isUntitled ? tab.name : undefined,
      })

      if (!dialogRes?.ok || !dialogRes.path) {
        set({ isSaving: false })
        return
      }

      const targetPath = dialogRes.path as string
      const saveRes: any = await client.rpc('editor.saveFile', {
        path: targetPath,
        content: tab.content,
        encoding: tab.encoding,
      })

      if (!saveRes?.ok || !saveRes.saved) {
        throw new Error(saveRes?.error || 'Failed to save file')
      }

      const absolutePath = saveRes.saved.path ?? targetPath
      const normalizedId = normalizeFsPath(absolutePath)
      if (!normalizedId) throw new Error('Failed to normalize saved file path')

      const language = detectLanguageFromPath(absolutePath)
      const isMarkdown = isMarkdownFile(absolutePath)
      const newUri = toModelUri(absolutePath)
      const version = tab.version + 1
      const previousPath = tab.path
      const previousId = tab.id
      let duplicatePaths: string[] = []

      set((state) => {
        const duplicates = state.tabs.filter((existing) => existing.id === normalizedId && existing.id !== previousId)
        duplicatePaths = duplicates.map((dup) => dup.path)
        const filtered = state.tabs.filter((existing) => existing.id !== normalizedId || existing.id === previousId)
        const nextTabs = filtered.map((existing) => {
          if (existing.id !== previousId) return existing
          return {
            ...existing,
            id: normalizedId,
            path: absolutePath,
            uri: newUri,
            name: getBasename(absolutePath) || existing.name,
            language,
            isMarkdown,
            viewMode: isMarkdown ? (existing.viewMode ?? 'rich') : 'source',
            savedContent: tab.content,
            content: tab.content,
            isDirty: false,
            size: saveRes.saved.size ?? existing.size,
            mtimeMs: saveRes.saved.mtimeMs ?? Date.now(),
            isUntitled: false,
            untitledId: undefined,
            isPreview: false,
            lastLoadedAt: Date.now(),
            version,
          }
        })

        const activeTabId = state.activeTabId === previousId ? normalizedId : state.activeTabId
        const previewTabId = state.previewTabId === previousId ? null : state.previewTabId

        return { tabs: nextTabs, activeTabId, previewTabId, isSaving: false }
      })

      persistTabsSnapshot(get().tabs, get().activeTabId)

      duplicatePaths.forEach((dupPath) => {
        if (dupPath && dupPath !== absolutePath) {
          void closeLspDocument(dupPath)
        }
      })

      if (!tab.isUntitled && !pathsEqual(previousPath, absolutePath)) {
        void closeLspDocument(previousPath)
      }

      const latest = get().tabs.find((t) => t.id === normalizedId)
      if (latest) {
        void (async () => {
          try {
            await openLspDocument({
              path: latest.path,
              languageId: resolveLspLanguage(latest.path, language),
              text: latest.content,
              version: latest.version,
            })
          } catch (err) {
            console.warn('[editorStore] Failed to sync LSP document after Save As', err)
          }
        })()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file'
      set({ isSaving: false, lastError: message })
      throw error
    }
  },

  saveActiveTabAs: async () => {
    const activeId = get().activeTabId
    if (!activeId) return
    await get().saveTabAs(activeId)
  },

  reloadTabFromDisk: async (tabId) => {
    const existing = get().tabs.find((t) => t.id === tabId)
    if (!existing || existing.isUntitled) return

    const inflight = inflightReloads.get(tabId)
    if (inflight) return inflight

    const reloadPromise = (async () => {
      try {
        const client = getBackendClient()
        if (!client) return

        const res: any = await client.rpc('explorer.readFile', { path: existing.path })
        if (!res?.ok || !res.file) throw new Error(res?.error || 'Failed to reload file')
        const file = res.file as OpenedFile
        const refreshed = createTabFromFile(file, existing, existing.viewMode)
        const merged: EditorTab = {
          ...existing,
          ...refreshed,
          uri: existing.uri,
          viewMode: existing.viewMode,
          isPreview: existing.isPreview,
          version: existing.version + 1,
        }
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? merged : tab)),
        }))
        void changeLspDocument({
          path: merged.path,
          languageId: resolveLspLanguage(merged.path, merged.language),
          text: merged.content,
          version: merged.version,
        })
      } catch (error) {
        console.warn('[editorStore] Failed to reload tab from disk', error)
      } finally {
        inflightReloads.delete(tabId)
      }
    })()

    inflightReloads.set(tabId, reloadPromise)
    return reloadPromise
  },

  handleFsEvent: (event) => {
    const { workspaceRoot, tabs } = get()
    if (!workspaceRoot || !pathsEqual(workspaceRoot, event.workspaceRoot)) return
    const normalizedPath = normalizeFsPath(event.path)
    if (!normalizedPath) return
    const targetTab = tabs.find((tab) => tab.id === normalizedPath)
    if (!targetTab || targetTab.isUntitled) return

    if (event.kind === 'file-removed') {
      get().closeTab(targetTab.id)
      return
    }

    if (!shouldReloadTabFromEvent(targetTab, event)) {
      return
    }

    void get().reloadTabFromDisk(targetTab.id)
  },

  toggleMarkdownView: (tabId, mode) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return {}
      const tab = state.tabs[index]
      if (!tab.isMarkdown) return {}
      const nextMode: EditorViewMode = mode ?? (tab.viewMode === 'rich' ? 'source' : 'rich')
      if (nextMode === tab.viewMode) return {}
      const nextTabs = state.tabs.slice()
      nextTabs[index] = {
        ...tab,
        viewMode: nextMode,
        markdownCanonicalizationExpiry: nextMode === 'rich' ? nextMarkdownCanonicalizationExpiry() : undefined,
      }
      return { tabs: nextTabs }
    })
    persistTabsSnapshot(get().tabs, get().activeTabId)
  },

  resetForWorkspace: (workspaceRoot) => {
    set({
      workspaceRoot,
      tabs: [],
      activeTabId: null,
      previewTabId: null,
      lastError: null,
      nextUntitledId: 1,
      pendingReveals: {},
      isSaving: false,
      isHydrating: false,
    })
  },

  hydrateFromPersistence: async () => {
    const saved = loadEditorState()
    if (!saved) return

    for (const entry of saved.tabs) {
      if (!entry.path) continue
      try {
        await get().openFile(entry.path, { activate: false, viewMode: entry.viewMode, mode: 'pinned' })
      } catch (error) {
        console.warn('[editor] Failed to hydrate tab', entry.path, error)
      }
    }
    if (saved.activePath) {
      const normalized = normalizeFsPath(saved.activePath)
      if (normalized) {
        const hasTab = get().tabs.some((tab) => tab.id === normalized)
        if (hasTab) {
          set({ activeTabId: normalized })
        }
      }
    }
  },

  revealRangeInFile: (filePath, range) => {
    const tabId = normalizeFsPath(filePath)
    if (!tabId) return
    set((state) => ({
      pendingReveals: { ...state.pendingReveals, [tabId]: range },
    }))
  },

  consumePendingReveal: (tabId) => {
    if (!tabId) return null
    const pending = get().pendingReveals[tabId]
    if (!pending) return null
    set((state) => {
      const next = { ...state.pendingReveals }
      delete next[tabId]
      return { pendingReveals: next }
    })
    return pending
  },
}))
