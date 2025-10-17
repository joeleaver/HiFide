/**
 * Workspace Slice
 *
 * Manages workspace folder state and operations.
 *
 * Responsibilities:
 * - Track current workspace root
 * - Manage recent folders list
 * - Handle folder opening and switching
 * - Manage file watching
 * - Handle context refresh/bootstrap
 *
 * Dependencies:
 * - Session slice (for saving/loading sessions)
 * - Terminal slice (for clearing terminals)
 * - Explorer slice (for loading file tree)
 * - Indexing slice (for rebuilding index)
 * - App slice (for bootstrap state)
 */

import type { StateCreator } from 'zustand'
import type { RecentFolder, FileWatchEvent, ContextRefreshResult } from '../types'
import { MAX_RECENT_FOLDERS } from '../utils/constants'
import path from 'node:path'
import fs from 'node:fs/promises'
import { resetIndexer, getIndexer } from '../../core/state'
import { bootstrapWorkspace } from '../utils/workspace-helpers'
import { buildMenu } from '../../ipc/menu'

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceSlice {
  // State
  workspaceRoot: string | null
  recentFolders: RecentFolder[]
  fileWatchCleanup: (() => void) | null
  fileWatchEvent: FileWatchEvent | null
  ctxRefreshing: boolean
  ctxResult: ContextRefreshResult | null
  
  // Actions
  setWorkspaceRoot: (folder: string | null) => void
  addRecentFolder: (path: string) => void
  clearRecentFolders: () => void
  openFolder: (folderPath: string) => Promise<{ ok: boolean; error?: string }>
  hasUnsavedChanges: () => boolean
  refreshContext: () => Promise<void>
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (set, get) => ({
  // State - Initialized with defaults, persist middleware will restore saved values
  workspaceRoot: null,
  recentFolders: [],
  fileWatchCleanup: null,
  fileWatchEvent: null,
  ctxRefreshing: false,
  ctxResult: null,
  
  // Actions
  setWorkspaceRoot: (folder: string | null) => {
    set({ workspaceRoot: folder })
  },
  
  addRecentFolder: (path: string) => {
    const state = get() as any
    const existing = state.recentFolders || []
    
    // Remove existing entry for this path
    const filtered = existing.filter((f: RecentFolder) => f.path !== path)
    
    // Add to front and limit to MAX_RECENT_FOLDERS
    const updated = [
      { path, lastOpened: Date.now() },
      ...filtered
    ].slice(0, MAX_RECENT_FOLDERS)

    set({ recentFolders: updated })

    // Notify to rebuild menu with updated recent folders
    try {
      buildMenu()
    } catch (e) {
      console.error('[workspace] Failed to rebuild menu:', e)
    }
  },

  clearRecentFolders: () => {
    set({ recentFolders: [] })

    // Notify to rebuild menu with cleared recent folders
    try {
      buildMenu()
    } catch (e) {
      console.error('[workspace] Failed to rebuild menu:', e)
    }
  },
  
  hasUnsavedChanges: () => {
    const state = get() as any
    
    // Check if current session has unsaved messages
    const current = state.sessions?.find((sess: any) => sess.id === state.currentId)
    if (current && current.messages.length > 0) {
      // Consider it "unsaved" if there are messages (user might want to keep them)
      return true
    }
    
    return false
  },
  
  openFolder: async (folderPath: string) => {
    try {
      const state = get() as any
      
      // Don't allow opening folder while app is still initializing
      if (state.appBootstrapping) {
        return { ok: false, error: 'App is still initializing' }
      }
      
      // Show loading screen
      if (state.setStartupMessage) {
        state.setStartupMessage('Opening workspace...')
      }
      set({ appBootstrapping: true } as any)
      
      // 1. Check for unsaved changes
      if (state.hasUnsavedChanges?.()) {
      }

      // 2. Save current session before switching
      if (state.setStartupMessage) state.setStartupMessage('Saving current session...')
      try {
        if (state.saveCurrentSession) {
          await state.saveCurrentSession()
        }
      } catch (e) {
        console.error('[workspace] Failed to save current session:', e)
      }

      // 3. Clear all explorer terminals
      if (state.setStartupMessage) state.setStartupMessage('Cleaning up terminals...')
      try {
        if (state.clearExplorerTerminals) {
          await state.clearExplorerTerminals()
        }
      } catch (e) {
        console.error('[workspace] Failed to clear explorer terminals:', e)
      }

      // 4. Update workspace root (APP_ROOT and indexer)
      if (state.setStartupMessage) state.setStartupMessage('Switching workspace...')
      try {
        const resolved = path.resolve(folderPath)
        // Verify the directory exists
        await fs.access(resolved)

        // Update APP_ROOT
        process.env.APP_ROOT = resolved

        // Reinitialize indexer with new root
        resetIndexer()
        getIndexer()
      } catch (error) {
        set({ appBootstrapping: false } as any)
        if (state.setStartupMessage) state.setStartupMessage(null)
        return { ok: false, error: String(error) }
      }
      
      // 5. Add to recent folders
      state.addRecentFolder(folderPath)
      
      // 6. Bootstrap workspace folders (.hifide-public, .hifide-private, etc.)
      if (state.setStartupMessage) state.setStartupMessage('Initializing workspace folders...')
      try {
        // Create folders and basic context (no LLM call - fast)
        await bootstrapWorkspace({ baseDir: folderPath, preferAgent: false, overwrite: false })
      } catch (e) {
        console.error('[workspace] Failed to bootstrap workspace:', e)
      }

      // 6b. Generate AI-enhanced context in the background (don't await)
      setTimeout(() => {
        bootstrapWorkspace({ baseDir: folderPath, preferAgent: true, overwrite: false }).catch((e) => {
          console.error('[workspace] Failed to generate AI context:', e)
        })
      }, 100)
      
      // 7. Reload sessions from new workspace
      if (state.setStartupMessage) state.setStartupMessage('Loading sessions...')
      try {
        if (state.loadSessions) {
          await state.loadSessions()
        }
      } catch (e) {
        console.error('[workspace] Failed to load sessions:', e)
      }

      // 8. Ensure a session is present
      let createdNewSession = false
      try {
        if (state.ensureSessionPresent) {
          createdNewSession = state.ensureSessionPresent()
        }
      } catch (e) {
        console.error('[workspace] Failed to ensure session:', e)
      }

      // 8b. Initialize the current session (loads flow, resumes if paused)
      // Only if we didn't create a new session (newSession already initializes)
      if (!createdNewSession) {
        try {
          if (state.initializeSession) {
            await state.initializeSession()
          }
        } catch (e) {
          console.error('[workspace] Failed to initialize session:', e)
        }
      }
      
      // 9. Start a new explorer terminal
      if (state.setStartupMessage) state.setStartupMessage('Setting up terminal...')
      try {
        const newTabId = crypto.randomUUID()
        set({
          explorerTerminalTabs: [newTabId],
          explorerActiveTerminal: newTabId
        } as any)
      } catch (e) {
        console.error('[workspace] Failed to create terminal:', e)
      }
      
      // 10. Update workspace root and load file tree
      if (state.setStartupMessage) state.setStartupMessage('Loading file tree...')
      set({
        workspaceRoot: folderPath,
        explorerOpenFolders: [folderPath],
        explorerChildrenByDir: {}
      } as any)
      
      // 10b. Check index status and build if needed
      try {
        if (state.setStartupMessage) state.setStartupMessage('Checking code index...')
        if (state.refreshIndexStatus) {
          await state.refreshIndexStatus()
        }
        const st = state.idxStatus
        const ready = !!st?.ready
        const chunks = st?.chunks ?? 0
        if (!ready && chunks === 0) {
          if (state.rebuildIndex) {
            await state.rebuildIndex()
          }
        }
      } catch (e) {
        console.error('[workspace] Failed to check/rebuild index:', e)
      }
      
      // Refresh context
      try {
        await state.refreshContext?.()
      } catch (e) {
        console.error('[workspace] Failed to refresh context:', e)
      }
      
      // Load initial file tree
      try {
        if (state.loadExplorerDir) {
          await state.loadExplorerDir(folderPath)
        }
      } catch (e) {
        console.error('[workspace] Failed to load file tree:', e)
      }
      
      // 11. File watching is handled by the IPC layer (fs:watchStart)
      // The renderer will set up file watching via window.fs.watchDir
      // This is intentionally left to the renderer since it needs to subscribe to events
      
      // Done
      set({ appBootstrapping: false } as any)
      if (state.setStartupMessage) state.setStartupMessage(null)
      return { ok: true }
    } catch (error) {
      console.error('[workspace] Failed to open folder:', error)
      set({ appBootstrapping: false } as any)
      const state = get() as any
      if (state.setStartupMessage) state.setStartupMessage(null)
      return { ok: false, error: String(error) }
    }
  },
  
  refreshContext: async () => {
    const state = get() as any
    const folder = state.workspaceRoot
    if (!folder) return

    set({ ctxRefreshing: true })
    try {
      const res = await bootstrapWorkspace({ baseDir: folder, preferAgent: true, overwrite: true })
      if (res) {
        set({ ctxResult: res })
      }
    } catch (e) {
      console.error('[workspace] Failed to refresh context:', e)
    } finally {
      set({ ctxRefreshing: false })
    }
  },
})

