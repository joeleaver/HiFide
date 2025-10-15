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
import { LS_KEYS, MAX_RECENT_FOLDERS } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage, removeFromLocalStorage } from '../utils/persistence'

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
  // State
  workspaceRoot: getFromLocalStorage<string | null>(LS_KEYS.WORKSPACE_ROOT, null),
  recentFolders: getFromLocalStorage<RecentFolder[]>(LS_KEYS.RECENT_FOLDERS, []),
  fileWatchCleanup: null,
  fileWatchEvent: null,
  ctxRefreshing: false,
  ctxResult: null,
  
  // Actions
  setWorkspaceRoot: (folder: string | null) => {
    set({ workspaceRoot: folder })
    
    if (folder) {
      setInLocalStorage(LS_KEYS.WORKSPACE_ROOT, folder)
    } else {
      removeFromLocalStorage(LS_KEYS.WORKSPACE_ROOT)
    }
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
    setInLocalStorage(LS_KEYS.RECENT_FOLDERS, updated)
    
    // Notify main process to update menu
    try {
      window.workspace?.notifyRecentFoldersChanged?.(updated)
    } catch (e) {
      console.error('[workspace] Failed to notify recent folders changed:', e)
    }
  },
  
  clearRecentFolders: () => {
    set({ recentFolders: [] })
    setInLocalStorage(LS_KEYS.RECENT_FOLDERS, [])
    
    // Notify main process to update menu
    try {
      window.workspace?.notifyRecentFoldersChanged?.([])
    } catch (e) {
      console.error('[workspace] Failed to notify recent folders changed:', e)
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
    const perfStart = performance.now()
    console.log('[workspace] Opening folder:', folderPath)
    
    try {
      const state = get() as any
      
      // Don't allow opening folder while app is still initializing
      if (state.appBootstrapping) {
        console.warn('[workspace] Cannot open folder while app is initializing')
        return { ok: false, error: 'App is still initializing' }
      }
      
      // Show loading screen
      if (state.setStartupMessage) {
        state.setStartupMessage('Opening workspace...')
      }
      set({ appBootstrapping: true } as any)
      
      // 1. Check for unsaved changes
      const t1 = performance.now()
      if (state.hasUnsavedChanges?.()) {
        console.warn('[workspace] Unsaved changes detected - proceeding anyway')
      }
      console.log(`[workspace] Check unsaved: ${(performance.now() - t1).toFixed(2)}ms`)
      
      // 2. Save current session before switching
      const t2 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Saving current session...')
      try {
        if (state.saveCurrentSession) {
          await state.saveCurrentSession()
        }
      } catch (e) {
        console.error('[workspace] Failed to save current session:', e)
      }
      console.log(`[workspace] Save session: ${(performance.now() - t2).toFixed(2)}ms`)
      
      // 3. Clear all explorer terminals
      const t3 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Cleaning up terminals...')
      try {
        if (state.clearExplorerTerminals) {
          await state.clearExplorerTerminals()
        }
      } catch (e) {
        console.error('[workspace] Failed to clear explorer terminals:', e)
      }
      console.log(`[workspace] Clear terminals: ${(performance.now() - t3).toFixed(2)}ms`)
      
      // 4. Update workspace root in main process
      const t4 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Switching workspace...')
      const setRootResult = await window.workspace?.setRoot?.(folderPath)
      if (!setRootResult?.ok) {
        set({ appBootstrapping: false } as any)
        if (state.setStartupMessage) state.setStartupMessage(null)
        return { ok: false, error: setRootResult?.error || 'Failed to set workspace root' }
      }
      console.log(`[workspace] Set root: ${(performance.now() - t4).toFixed(2)}ms`)
      
      // 5. Add to recent folders
      const t5 = performance.now()
      state.addRecentFolder(folderPath)
      console.log(`[workspace] Add recent: ${(performance.now() - t5).toFixed(2)}ms`)
      
      // 6. Bootstrap workspace folders (.hifide-public, .hifide-private, etc.)
      const t6 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Initializing workspace folders...')
      try {
        // Create folders and basic context (no LLM call - fast)
        await window.workspace?.bootstrap?.(folderPath, false, false)
      } catch (e) {
        console.error('[workspace] Failed to bootstrap workspace:', e)
      }
      console.log(`[workspace] Bootstrap: ${(performance.now() - t6).toFixed(2)}ms`)
      
      // 6b. Generate AI-enhanced context in the background (don't await)
      setTimeout(() => {
        window.workspace?.bootstrap?.(folderPath, true, false).catch((e) => {
          console.error('[workspace] Failed to generate AI context:', e)
        })
      }, 100)
      
      // 7. Reload sessions from new workspace
      const t7 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Loading sessions...')
      try {
        if (state.loadSessions) {
          await state.loadSessions()
        }
      } catch (e) {
        console.error('[workspace] Failed to load sessions:', e)
      }
      console.log(`[workspace] Load sessions: ${(performance.now() - t7).toFixed(2)}ms`)
      
      // 8. Ensure a session is present
      try {
        if (state.ensureSessionPresent) {
          state.ensureSessionPresent()
        }
      } catch (e) {
        console.error('[workspace] Failed to ensure session:', e)
      }
      
      // 9. Start a new explorer terminal
      const t8 = performance.now()
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
      console.log(`[workspace] Create terminal: ${(performance.now() - t8).toFixed(2)}ms`)
      
      // 10. Update workspace root and load file tree
      const t9 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Loading file tree...')
      set({
        workspaceRoot: folderPath,
        explorerOpenFolders: new Set([folderPath]),
        explorerChildrenByDir: {}
      } as any)
      setInLocalStorage(LS_KEYS.WORKSPACE_ROOT, folderPath)
      
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
      console.log(`[workspace] Load tree: ${(performance.now() - t9).toFixed(2)}ms`)
      
      // 11. Start file watcher
      const t10 = performance.now()
      if (state.setStartupMessage) state.setStartupMessage('Starting file watcher...')
      try {
        if (window.fs?.watchDir) {
          await window.fs.watchDir(folderPath)
        }
      } catch (e) {
        console.error('[workspace] Failed to start file watcher:', e)
      }
      console.log(`[workspace] File watcher: ${(performance.now() - t10).toFixed(2)}ms`)
      
      // 12. Set up file watch event handler
      const currentCleanup = state.fileWatchCleanup
      if (currentCleanup) {
        try {
          currentCleanup()
        } catch (e) {
          console.error('[workspace] Failed to cleanup old watcher:', e)
        }
      }
      
      if (window.fs?.onWatch) {
        const cleanup = window.fs.onWatch((ev: { id: number; type: 'rename' | 'change'; path: string; dir: string }) => {
          const currentRoot = (get() as any).workspaceRoot
          if (!currentRoot || !ev?.path) return
          if (!ev.path.startsWith(currentRoot)) return
          
          set({ fileWatchEvent: { path: ev.path, type: ev.type, timestamp: Date.now() } })
        })
        set({ fileWatchCleanup: cleanup })
      }
      
      // Done
      set({ appBootstrapping: false } as any)
      if (state.setStartupMessage) state.setStartupMessage(null)
      console.log(`[workspace] TOTAL: ${(performance.now() - perfStart).toFixed(2)}ms`)
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
      const res = await window.workspace?.bootstrap?.(folder, true, true)
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

