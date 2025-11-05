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
import { getIndexer, resetIndexer, startKanbanWatcher, stopKanbanWatcher } from '../../core/state'

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
        stopKanbanWatcher()
      } catch (error) {
        console.error('[workspace] Failed to stop Kanban watcher:', error)
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
      } else {
        stopKanbanWatcher()
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
    const current = state.sessions?.find((session: any) => session.id === state.currentId)
    if (!current) return false
    return Boolean(current.items?.length)
  },

  async openFolder(folderPath) {
    const normalized = normalizePath(folderPath)
    const state = store.getState() as WorkspaceStore

    if (state.appBootstrapping) {
      console.warn('[workspace] Attempted to open folder while bootstrapping')
      return { ok: false, error: 'App is still initializing' }
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

    set({ appBootstrapping: true } as any)
    state.setStartupMessage?.('Opening workspace...')

    try {
      if (state.saveCurrentSession) {
        state.setStartupMessage?.('Saving current session...')
        await state.saveCurrentSession()
      }

      state.setStartupMessage?.('Ensuring workspace context...')
      const ready = await (get() as WorkspaceSlice).ensureWorkspaceReady({ baseDir: normalized })
      if (!ready.ok) {
        throw new Error('Failed to prepare workspace')
      }

      state.setStartupMessage?.('Resetting explorers...')
      if (state.clearExplorer) {
        await state.clearExplorer()
      }

      set({ workspaceRoot: normalized } as any)
      ;(get() as WorkspaceSlice).addRecentFolder(normalized)

      if (state.loadExplorer) {
        state.setStartupMessage?.('Loading workspace files...')
        await state.loadExplorer(normalized)
      }

      try {
        (await getIndexer()).switchRoot(normalized)
      } catch (error) {
        console.error('[workspace] Failed to switch indexer root:', error)
      }

      (get() as WorkspaceSlice).setWorkspaceRoot(normalized)

      state.setStartupMessage?.(null)
      set({ appBootstrapping: false } as any)
      return { ok: true }
    } catch (error) {
      console.error('[workspace] Failed to open workspace:', error)
      set({ appBootstrapping: false } as any)
      state.setStartupMessage?.(null)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  closeWorkspace() {
    const state = get()
    state.fileWatchCleanup?.()
    set({
      workspaceRoot: null,
      fileWatchCleanup: null,
      fileWatchEvent: null,
    })
    try {
      stopKanbanWatcher()
    } catch (error) {
      console.error('[workspace] Failed to stop Kanban watcher:', error)
    }
    try {
      resetIndexer()
    } catch (error) {
      console.error('[workspace] Failed to reset indexer:', error)
    }
  },
})
