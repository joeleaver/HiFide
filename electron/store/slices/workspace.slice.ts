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

    // Check if current session has unsaved items
    const current = state.sessions?.find((sess: any) => sess.id === state.currentId)
    if (current && current.items && current.items.length > 0) {
      // Consider it "unsaved" if there are items (user might want to keep them)
      return true
    }

    return false
  },
  
  openFolder: async (folderPath: string) => {
    console.log('[workspace] openFolder called with:', folderPath)
    // Store the old workspace root in case we need to restore it on error
    const oldWorkspaceRoot = get().workspaceRoot

    try {
      const state = get() as any

      // Don't allow opening folder while app is still initializing
      if (state.appBootstrapping) {
        console.log('[workspace] App is still bootstrapping, rejecting folder open')
        return { ok: false, error: 'App is still initializing' }
      }

      // Show loading screen
      if (state.setStartupMessage) {
        state.setStartupMessage('Opening workspace...')
      }
      set({ appBootstrapping: true } as any)

      // 1. Check for unsaved changes
      console.log('[workspace] Step 1: Checking for unsaved changes')
      if (state.hasUnsavedChanges?.()) {
      }

      // 2. Save current session before switching
      console.log('[workspace] Step 2: Saving current session')
      if (state.setStartupMessage) state.setStartupMessage('Saving current session...')
      try {
        if (state.saveCurrentSession) {
          await state.saveCurrentSession()
        }
        console.log('[workspace] Step 2 complete')
      } catch (e) {
        console.error('[workspace] Failed to save current session:', e)
      }

      // 3. Clear all explorer terminals
      console.log('[workspace] Step 3: Clearing terminals')
      if (state.setStartupMessage) state.setStartupMessage('Cleaning up terminals...')
      try {
        if (state.clearExplorerTerminals) {
          await state.clearExplorerTerminals()
        }
        console.log('[workspace] Step 3 complete')
      } catch (e) {
        console.error('[workspace] Failed to clear explorer terminals:', e)
      }

      // 4. Verify folder exists and reinitialize indexer
      console.log('[workspace] Step 4: Verifying folder and reinitializing indexer')
      if (state.setStartupMessage) state.setStartupMessage('Switching workspace...')
      try {
        const resolved = path.resolve(folderPath)
        console.log('[workspace] Resolved path:', resolved)
        // Verify the directory exists
        await fs.access(resolved)
        console.log('[workspace] Directory exists, reinitializing indexer')

        // Reinitialize indexer with new root
        resetIndexer()
        await getIndexer()
        console.log('[workspace] Step 4 complete')
      } catch (error) {
        console.error('[workspace] Step 4 failed:', error)
        // Restore old workspace root on error
        set({ appBootstrapping: false, workspaceRoot: oldWorkspaceRoot } as any)
        if (state.setStartupMessage) state.setStartupMessage(null)
        return { ok: false, error: String(error) }
      }
      
      // 5. Add to recent folders
      console.log('[workspace] Step 5: Adding to recent folders')
      state.addRecentFolder(folderPath)
      console.log('[workspace] Step 5 complete')

      // 6. Bootstrap workspace folders (.hifide-public, .hifide-private, etc.)
      console.log('[workspace] Step 6: Bootstrapping workspace folders')
      if (state.setStartupMessage) state.setStartupMessage('Initializing workspace folders...')
      try {
        // Create folders and basic context (no LLM call - fast)
        await bootstrapWorkspace({ baseDir: folderPath, preferAgent: false, overwrite: false })
        console.log('[workspace] Step 6 complete')
      } catch (e) {
        console.error('[workspace] Failed to bootstrap workspace:', e)
      }

      // 6b. Generate AI-enhanced context in the background (don't await)
      setTimeout(() => {
        bootstrapWorkspace({ baseDir: folderPath, preferAgent: true, overwrite: false }).catch((e) => {
          console.error('[workspace] Failed to generate AI context:', e)
        })
      }, 100)

      // 7. Update workspace root BEFORE loading sessions
      // This ensures that session loading, flow loading, and settings saving all use the correct workspace
      console.log('[workspace] Setting workspaceRoot to:', folderPath)
      set({
        workspaceRoot: folderPath,
        explorerOpenFolders: [folderPath],
        explorerChildrenByDir: {}
      } as any)
      console.log('[workspace] workspaceRoot updated, current value:', get().workspaceRoot)

      // 8. Reload sessions from new workspace
      console.log('[workspace] Step 8: Loading sessions')
      if (state.setStartupMessage) state.setStartupMessage('Loading sessions...')
      try {
        if (state.loadSessions) {
          await state.loadSessions()
        }
        console.log('[workspace] Step 8 complete')
      } catch (e) {
        console.error('[workspace] Failed to load sessions:', e)
      }

      // 9. Ensure a session is present
      console.log('[workspace] Step 9: Ensuring session present')
      let createdNewSession = false
      try {
        if (state.ensureSessionPresent) {
          createdNewSession = state.ensureSessionPresent()
        }
        console.log('[workspace] Step 9 complete, createdNewSession:', createdNewSession)
      } catch (e) {
        console.error('[workspace] Failed to ensure session:', e)
      }

      // 9b. Initialize the current session (loads flow, resumes if paused)
      // Only if we didn't create a new session (newSession already initializes)
      console.log('[workspace] Step 9b: Initializing session')
      if (!createdNewSession) {
        try {
          if (state.initializeSession) {
            await state.initializeSession()
          }
          console.log('[workspace] Step 9b complete')
        } catch (e) {
          console.error('[workspace] Failed to initialize session:', e)
        }
      } else {
        console.log('[workspace] Step 9b skipped (new session already initialized)')
      }

      // 10. Start a new explorer terminal
      console.log('[workspace] Step 10: Setting up terminal')
      if (state.setStartupMessage) state.setStartupMessage('Setting up terminal...')
      try {
        const newTabId = crypto.randomUUID()
        set({
          explorerTerminalTabs: [newTabId],
          explorerActiveTerminal: newTabId
        } as any)
        console.log('[workspace] Step 10 complete')
      } catch (e) {
        console.error('[workspace] Failed to create terminal:', e)
      }

      // 11. Load file tree
      console.log('[workspace] Step 11: Loading file tree')
      if (state.setStartupMessage) state.setStartupMessage('Loading file tree...')

      // 11b. Check index status and build if needed
      try {
        console.log('[workspace] Step 11b: Checking code index')
        if (state.setStartupMessage) state.setStartupMessage('Checking code index...')
        if (state.refreshIndexStatus) {
          await state.refreshIndexStatus()
        }
        const st = state.idxStatus
        const ready = !!st?.ready
        const chunks = st?.chunks ?? 0
        console.log('[workspace] Index status - ready:', ready, 'chunks:', chunks)
        if (!ready && chunks === 0) {
          console.log('[workspace] Rebuilding index...')
          if (state.rebuildIndex) {
            await state.rebuildIndex()
          }
        }
        console.log('[workspace] Step 11b complete')
      } catch (e) {
        console.error('[workspace] Failed to check/rebuild index:', e)
      }

      // Refresh context
      console.log('[workspace] Refreshing context')
      try {
        await state.refreshContext?.()
        console.log('[workspace] Context refresh complete')
      } catch (e) {
        console.error('[workspace] Failed to refresh context:', e)
      }

      // Load initial file tree
      console.log('[workspace] Loading initial file tree')
      try {
        if (state.loadExplorerDir) {
          await state.loadExplorerDir(folderPath)
        }
        console.log('[workspace] File tree loaded')
      } catch (e) {
        console.error('[workspace] Failed to load file tree:', e)
      }

      // 12. File watching is handled by the IPC layer (fs:watchStart)
      // The renderer will set up file watching via window.fs.watchDir
      // This is intentionally left to the renderer since it needs to subscribe to events
      
      // Done
      set({ appBootstrapping: false } as any)
      if (state.setStartupMessage) state.setStartupMessage(null)
      console.log('[workspace] openFolder completed successfully')
      return { ok: true }
    } catch (error) {
      console.error('[workspace] Failed to open folder:', error)
      // Restore old workspace root on error
      set({ appBootstrapping: false, workspaceRoot: oldWorkspaceRoot } as any)
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

