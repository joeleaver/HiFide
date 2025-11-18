/**
 * Explorer Slice
 *
 * Manages file explorer tree state and operations.
 *
 * Responsibilities:
 * - Track open/closed folders in the tree
 * - Load directory contents
 * - Toggle folder expansion
 * - Open files for viewing
 * - Manage opened file state
 *
 * Dependencies:
 * - Workspace slice (for workspace root)
 */

import type { StateCreator } from 'zustand'
import type { ExplorerEntry, OpenedFile } from '../types'
import fs from 'node:fs/promises'
import path from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface ExplorerSlice {
  // State
  explorerOpenFolders: string[] // Array (JSON-serializable) instead of Set for persistence/IPC
  explorerChildrenByDir: Record<string, ExplorerEntry[]>
  openedFile: OpenedFile | null

  // Actions
  loadExplorerDir: (dirPath: string) => Promise<void>
  toggleExplorerFolder: (dirPath: string) => Promise<void>
  openFile: (path: string) => Promise<void>
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createExplorerSlice: StateCreator<ExplorerSlice, [], [], ExplorerSlice> = (set, get) => ({
  // State
  explorerOpenFolders: [],
  explorerChildrenByDir: {},
  openedFile: null,
  
  // Actions
  loadExplorerDir: async (dirPath: string) => {
    try {
      let entries: ExplorerEntry[]

      // In main process, use Node.js fs directly
      if (typeof window === 'undefined') {
        const dirEntries = await fs.readdir(dirPath, { withFileTypes: true })
        entries = dirEntries.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(dirPath, entry.name)
        }))
      } else {
        // In renderer process, use IPC
        if (!window.fs) {
          return
        }

        const res = await window.fs.readDir(dirPath)

        if (!res?.success || !Array.isArray(res.entries)) {
          return
        }

        entries = res.entries
      }

      // Sort entries: directories first, then alphabetically
      const sortedEntries = [...entries].sort((a, b) => {
        // Directories come before files
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        // Alphabetical sort (case-insensitive)
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })

      // Update the children for this directory
      set((state) => ({
        explorerChildrenByDir: {
          ...state.explorerChildrenByDir,
          [dirPath]: sortedEntries,
        },
      }))

    } catch (e) {
      console.error('[explorer] Failed to load directory:', dirPath, e)
    }
  },
  
  toggleExplorerFolder: async (dirPath: string) => {
    const state = get()
    const isOpen = state.explorerOpenFolders.includes(dirPath)

    // Load directory contents if not already loaded and we're opening it
    if (!isOpen && !state.explorerChildrenByDir[dirPath]) {
      await state.loadExplorerDir(dirPath)
    }

    // Toggle open state
    let next: string[]
    if (isOpen) {
      next = state.explorerOpenFolders.filter(p => p !== dirPath)
    } else {
      next = [...state.explorerOpenFolders, dirPath]
    }

    set({ explorerOpenFolders: next })
  },
  
  openFile: async (filePath: string) => {
    try {
      let content: string

      // In main process, use Node.js fs directly
      if (typeof window === 'undefined') {
        content = await fs.readFile(filePath, 'utf-8')
      } else {
        // In renderer process, use IPC
        if (!window.fs) {
          return
        }

        const res = await window.fs.readFile(filePath)

        if (!res?.success || !res.content) {
          return
        }

        content = res.content
      }

      // Extract filename from path
      const name = filePath.split(/[/\\]/).pop() || filePath

      // Infer language from file extension
      const ext = name.split('.').pop()?.toLowerCase()
      const languageMap: Record<string, string> = {
        // JavaScript/TypeScript
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',

        // Web
        json: 'json',
        css: 'css',
        scss: 'scss',
        sass: 'sass',
        less: 'less',
        html: 'html',
        htm: 'html',
        xml: 'xml',
        svg: 'xml',

        // Markdown
        md: 'markdown',
        mdx: 'markdown',

        // Python
        py: 'python',
        pyw: 'python',

        // Rust
        rs: 'rust',

        // Go
        go: 'go',

        // Java
        java: 'java',

        // C/C++
        c: 'c',
        h: 'c',
        cpp: 'cpp',
        hpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',

        // C#
        cs: 'csharp',

        // PHP
        php: 'php',

        // Ruby
        rb: 'ruby',

        // Shell
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',

        // Config
        yaml: 'yaml',
        yml: 'yaml',
        toml: 'toml',
        ini: 'ini',

        // SQL
        sql: 'sql',

        // Other
        txt: 'plaintext',
        log: 'plaintext',
      }

      const language = languageMap[ext || ''] || 'plaintext'

      set({
        openedFile: {
          path: filePath,
          content,
          language,
        },
      })

    } catch (e) {
      console.error('[explorer] Failed to open file:', filePath, e)
    }
  },
})

