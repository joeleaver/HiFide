import type { StateCreator } from 'zustand'

import { getBackendClient } from '@/lib/backend/bootstrap'
import { confirmDialog, promptDialog } from '@/store/dialogs'

import type { ExplorerContextMenuSlice, ExplorerStore, ExplorerTreeRow } from './types'
import { collectSelectedRows, isRootRow } from './selection'

const initialContextMenuState = { isOpen: false, x: 0, y: 0, target: null as ExplorerTreeRow | null }

export const createExplorerContextMenuSlice: StateCreator<ExplorerStore, [], [], ExplorerContextMenuSlice> = (set, get) => ({
  contextMenu: initialContextMenuState,
  showContextMenu: (target, position) => {
    set({
      contextMenu: {
        isOpen: true,
        x: Math.max(8, position.x),
        y: Math.max(8, position.y),
        target: cloneTreeRow(target),
      },
    })
  },
  hideContextMenu: () => {
    set({ contextMenu: initialContextMenuState })
  },
  invokeContextAction: async (action, targetOverride) => {
    const state = get()
    const target = targetOverride ?? state.contextMenu.target
    const client = getBackendClient()
    if (!client) throw new Error('No backend connection')

    const rpc = async (method: string, params: Record<string, any>) => {
      const res: any = await client.rpc(method, params)
      if (!res?.ok) {
        throw new Error(res?.error || `Failed to execute ${method}`)
      }
      return res
    }

    const closeMenu = () => set({ contextMenu: initialContextMenuState })
    const getActionRows = (opts?: { allowRoot?: boolean }) => getRowsForAction(get(), target ?? null, opts)

    try {
      switch (action) {
        case 'copy':
        case 'cut': {
          const rows = getActionRows()
          if (!rows.length) {
            closeMenu()
            return
          }
          closeMenu()
          get().setClipboardFromRows(action, rows)
          set({ lastError: null })
          return
        }
        case 'paste': {
          closeMenu()
          const clipboard = get().clipboard
          const sources = clipboard?.entries?.map((entry) => entry.path).filter(Boolean) as string[] | undefined
          if (!clipboard || !sources?.length) {
            return
          }
          const destinationDir = determineDirectoryForTarget(target, get())
          if (!destinationDir) throw new Error('Select a folder to paste into')
          await rpc('explorer.pasteEntries', {
            sources,
            destination: destinationDir,
            mode: clipboard.mode,
          })
          await get().refreshDirectory(destinationDir, { force: true })
          if (clipboard.mode === 'cut') {
            get().clearClipboardState()
          }
          set({ lastError: null })
          return
        }
        case 'new-file':
        case 'new-folder': {
          const destinationDir = determineDirectoryForTarget(target, get())
          if (!destinationDir) throw new Error('Open a workspace to create files')
          closeMenu()
          const defaultName = action === 'new-folder' ? 'New Folder' : 'untitled.ts'
          const promptTitle = action === 'new-folder' ? 'New Folder' : 'New File'
          const promptText = action === 'new-folder' ? 'Enter a folder name' : 'Enter a file name'
          const desiredName = (await promptDialog({
            title: promptTitle,
            message: promptText,
            defaultValue: defaultName,
            placeholder: defaultName,
            confirmLabel: 'Create',
          }))?.trim()
          if (!desiredName) {
            return
          }
          await rpc('explorer.createEntry', {
            parentDir: destinationDir,
            name: desiredName,
            type: action === 'new-folder' ? 'folder' : 'file',
          })
          await get().refreshDirectory(destinationDir, { force: true })
          set({ lastError: null })
          return
        }
        case 'rename': {
          const rows = getActionRows({ allowRoot: false })
          const entry = rows[0]
          if (isRootRow(entry)) {
            closeMenu()
            return
          }
          if (!entry?.path) {
            closeMenu()
            throw new Error('Missing entry path')
          }
          closeMenu()
          const newName = (await promptDialog({
            title: 'Rename',
            message: `Rename "${entry.name}" to:`,
            defaultValue: entry.name,
            placeholder: entry.name,
            confirmLabel: 'Rename',
          }))?.trim()
          if (!newName || newName === entry.name) {
            return
          }
          await rpc('explorer.renameEntry', { path: entry.path, name: newName })
          const parentDir = entry.parentPath ?? entry.path
          if (parentDir) {
            await get().refreshDirectory(parentDir, { force: true })
          }
          set({ lastError: null })
          return
        }
        case 'duplicate': {
          const entry = requireActionTarget(target)
          if (!entry.path) throw new Error('Missing entry path')
          await rpc('explorer.duplicateEntry', { path: entry.path })
          const parentDir = entry.parentPath ?? entry.path
          if (parentDir) {
            await get().refreshDirectory(parentDir, { force: true })
          }
          closeMenu()
          set({ lastError: null })
          return
        }
        case 'delete': {
          const rows = getActionRows()
          if (!rows.length) {
            closeMenu()
            return
          }
          const confirmed = await confirmDialog({
            title: rows.length === 1 ? `Delete ${rows[0].type === 'folder' ? 'Folder' : 'File'}` : `Delete ${rows.length} items`,
            message:
              rows.length === 1
                ? `Delete "${rows[0].name}"? This cannot be undone.`
                : `Delete ${rows.length} selected items? This cannot be undone.`,
            confirmLabel: 'Delete',
            intent: 'danger',
          })
          if (!confirmed) {
            closeMenu()
            return
          }
          const parentDirs = new Set<string>()
          for (const entry of rows) {
            if (!entry.path) continue
            await rpc('explorer.deleteEntry', { path: entry.path })
            const parentDir = entry.parentPath ?? get().workspaceRoot
            if (parentDir) parentDirs.add(parentDir)
          }
          for (const dir of parentDirs) {
            await get().refreshDirectory(dir, { force: true })
          }
          closeMenu()
          get().clearSelection()
          set({ lastError: null })
          return
        }
        default:
          closeMenu()
          return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Explorer action failed'
      set({ lastError: message })
      closeMenu()
      throw error
    }
  },
})

function cloneTreeRow(row: ExplorerTreeRow | null): ExplorerTreeRow | null {
  if (!row) return null
  return { ...row }
}

function requireActionTarget(target: ExplorerTreeRow | null): ExplorerTreeRow {
  if (!target || !target.path) {
    throw new Error('Select a file or folder first')
  }
  return target
}

function determineDirectoryForTarget(target: ExplorerTreeRow | null, state: ExplorerStore): string | null {
  if (target?.type === 'folder' && target.path) {
    return target.path
  }
  if (target?.parentPath) {
    return target.parentPath
  }
  return state.workspaceRoot
}

function getRowsForAction(state: ExplorerStore, fallback: ExplorerTreeRow | null, opts: { allowRoot?: boolean } = {}): ExplorerTreeRow[] {
  const selection = collectSelectedRows(state, { includeRoot: opts.allowRoot })
  if (selection.length) return selection
  if (fallback && fallback.path) {
    if (!opts.allowRoot && isRootRow(fallback)) return []
    return [fallback]
  }
  return []
}
