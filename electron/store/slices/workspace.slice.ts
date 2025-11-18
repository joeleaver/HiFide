/**
 * Workspace Slice
 *
 * Manages workspace selection, recent folders, and bootstrap helpers shared
 * between the main and renderer processes.
 */

import type { StateCreator } from 'zustand'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RecentFolder, FileWatchEvent, ContextRefreshResult } from '../types'
import { MAX_RECENT_FOLDERS } from '../utils/constants'
import { bootstrapWorkspace } from '../utils/workspace-helpers'
import { buildMenu } from '../../ipc/menu'
import { resetIndexer, resetKbIndexer, startKanbanWatcher, stopKanbanWatcher, startKbWatcher, stopKbWatcher } from '../../core/state'

export interface WorkspaceSlice {
  workspaceRoot: string | null
  recentFolders: RecentFolder[]
  fileWatchCleanup: (() => void) | null
  fileWatchEvent: FileWatchEvent | null
  ctxRefreshing: boolean
  ctxResult: ContextRefreshResult | null

  setWorkspaceRoot: (folder: string | null) => void
  addRecentFolder: (folder: string) => void
  clearRecentFolders: () => void
  ensureWorkspaceReady: (params: { baseDir: string; preferAgent?: boolean; overwrite?: boolean }) => Promise<{ ok: boolean }>
  hasUnsavedChanges: () => boolean
  openFolder: (folderPath: string) => Promise<{ ok: boolean; error?: string }>
  closeWorkspace: () => void
}

type WorkspaceStore = WorkspaceSlice & {
  idxLastRebuildAt?: number | undefined
  appBootstrapping?: boolean
  setStartupMessage?: (message: string | null) => void
  setWorkspaceBoot?: (params: { workspaceId: string; bootstrapping?: boolean; message?: string | null }) => void
  saveCurrentSession?: () => Promise<void>
  clearExplorer?: () => Promise<void>
  loadExplorer?: (root: string) => Promise<void>
}

const RECENT_FOLDER_SCHEMA_VERSION = 1

function normalizePath(folderPath: string): string {
  return path.resolve(folderPath)
}

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (set, get, store) => ({
  workspaceRoot: null,
  recentFolders: [],
  fileWatchCleanup: null,
  fileWatchEvent: null,
  ctxRefreshing: false,
  ctxResult: null,

  setWorkspaceRoot(folder) {
    const state = store.getState() as WorkspaceStore
    const previous = state.workspaceRoot

    if (previous && previous !== folder) {
      try {
        stopKanbanWatcher(previous)
      } catch (error) {
        console.error('[workspace] Failed to stop Kanban watcher:', error)
      }
      try {
        stopKbWatcher(previous)
      } catch (error) {
        console.error('[workspace] Failed to stop KB watcher:', error)
      }
    }

    if (previous !== folder) {
      set({ workspaceRoot: folder, idxLastRebuildAt: undefined } as any)
    } else {
      set({ workspaceRoot: folder } as any)
    }

    try {
      if (folder) {
        process.env.HIFIDE_WORKSPACE_ROOT = folder
        startKanbanWatcher(folder).catch((error) => {
          console.error('[workspace] Failed to start Kanban watcher:', error)
        })
        startKbWatcher(folder).catch((error) => {
          console.error('[workspace] Failed to start KB watcher:', error)
        })
      } else {
        stopKanbanWatcher()
        stopKbWatcher()
      }
    } catch (error) {
      console.error('[workspace] Failed to sync workspace environment variable:', error)
    }
  },

  addRecentFolder(folderPath) {
    const normalized = normalizePath(folderPath)
    const state = get()
    const filtered = state.recentFolders.filter((entry) => entry.path !== normalized)
    const next: RecentFolder[] = [
      { path: normalized, lastOpened: Date.now(), version: RECENT_FOLDER_SCHEMA_VERSION as number } as RecentFolder,
      ...filtered,
    ].slice(0, MAX_RECENT_FOLDERS)

    set({ recentFolders: next })

    try {
      buildMenu()
    } catch (error) {
      console.error('[workspace] Failed to rebuild menu after updating recents:', error)
    }
  },

  clearRecentFolders() {
    set({ recentFolders: [] })
    try {
      buildMenu()
    } catch (error) {
      console.error('[workspace] Failed to rebuild menu after clearing recents:', error)
    }
  },

  async ensureWorkspaceReady({ baseDir, preferAgent = false, overwrite = false }) {
    try {
      await bootstrapWorkspace({ baseDir, preferAgent: false, overwrite })
      if (preferAgent) {
        setTimeout(() => {
          bootstrapWorkspace({ baseDir, preferAgent: true, overwrite: false }).catch((error) => {
            console.error('[workspace] Background context generation failed:', error)
          })
        }, 100)
      }
      return { ok: true }
    } catch (error) {
      console.error('[workspace] ensureWorkspaceReady failed:', error)
      return { ok: false }
    }
  },

  hasUnsavedChanges() {
    const state = store.getState() as any
    const ws = state.workspaceRoot || null
    if (!ws) return false
    const list = (state.sessionsByWorkspace?.[ws] || []) as any[]
    const cur = (state.currentIdByWorkspace?.[ws] ?? null) as string | null
    const current = list.find((s: any) => s.id === cur)
    if (!current) return false
    return Boolean(current.items?.length)
  },

  async openFolder(folderPath) {
    const normalized = normalizePath(folderPath)
    const state = store.getState() as WorkspaceStore

    // Allow opening a folder during app bootstrap; do not block user action.
    // initializeApp may still be running (e.g., validating keys), but workspace open is safe.
    if (state.appBootstrapping) {
      console.warn('[workspace] openFolder called during app bootstrap; proceeding with open')
    }

    try {
      await fs.access(normalized)
    } catch (error) {
      console.error('[workspace] Folder is not accessible:', error)
      return { ok: false, error: 'Folder is not accessible' }
    }

    if (state.hasUnsavedChanges?.()) {
      console.warn('[workspace] Unsaved changes detected before switching workspace')
    }

    { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, bootstrapping: true, message: 'Opening workspace...' }) }

    try {
      if (state.saveCurrentSession) {
        { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Saving current session...' }) }
        await state.saveCurrentSession()
      }

      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Ensuring workspace context...' }) }
      const ready = await (get() as WorkspaceSlice).ensureWorkspaceReady({ baseDir: normalized })
      if (!ready.ok) {
        throw new Error('Failed to prepare workspace')
      }

      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Resetting explorers...' }) }
      if (state.clearExplorer) {
        await state.clearExplorer()
      }

      set({ workspaceRoot: normalized } as any)
      ;(get() as WorkspaceSlice).addRecentFolder(normalized)

      if (state.loadExplorer) {
        { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Loading workspace files...' }) }
        await state.loadExplorer(normalized)
      }

      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Switching search index…' }) }


      (get() as WorkspaceSlice).setWorkspaceRoot(normalized)

      // Load sessions for this workspace and ensure one is selected/initialized (strict gating)
      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Loading sessions…' }) }
      const anyState = get() as any
      if (anyState.loadSessionsFor) await anyState.loadSessionsFor({ workspaceId: normalized })
      // Ensure at least one session exists and a currentId is set
      let createdNewSession = false
      if (typeof anyState.ensureSessionPresentFor === 'function') {
        createdNewSession = anyState.ensureSessionPresentFor({ workspaceId: normalized })
      }
      const list = (typeof anyState.getSessionsFor === 'function') ? (anyState.getSessionsFor({ workspaceId: normalized }) || []) : []
      const cur = (typeof anyState.getCurrentIdFor === 'function') ? anyState.getCurrentIdFor({ workspaceId: normalized }) : null
      if (!Array.isArray(list) || list.length === 0 || !cur) {
        throw new Error('Sessions not available after load')
      }
      if (!createdNewSession) {
        { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, message: 'Initializing session…' }) }
        if (typeof anyState.initializeSessionFor === 'function') {
          await anyState.initializeSessionFor({ workspaceId: normalized })
        }
      }

      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, bootstrapping: false, message: null }) }
      return { ok: true }
    } catch (error) {
      console.error('[workspace] Failed to open workspace:', error)
      { const __fn = (store.getState() as any).setWorkspaceBoot; if (typeof __fn === 'function') __fn({ workspaceId: normalized, bootstrapping: false, message: null }) }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  closeWorkspace() {
    const state = get()
    const prevRoot = (state as any).workspaceRoot || null
    state.fileWatchCleanup?.()
    set({
      workspaceRoot: null,
      fileWatchCleanup: null,
      fileWatchEvent: null,
    })
    try {
      if (prevRoot) stopKanbanWatcher(prevRoot)
    } catch (error) {
      console.error('[workspace] Failed to stop Kanban watcher:', error)
    }
    try {
      if (prevRoot) stopKbWatcher(prevRoot)
    } catch (error) {
      console.error('[workspace] Failed to stop KB watcher:', error)
    }
    try {
      resetIndexer(prevRoot as any)
    } catch (error) {
      console.error('[workspace] Failed to reset indexer:', error)
    }
    try {
      resetKbIndexer(prevRoot as any)
    } catch (error) {
      console.error('[workspace] Failed to reset KB indexer:', error)
    }
  },
})
