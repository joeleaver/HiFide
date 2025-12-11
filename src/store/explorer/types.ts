import type { StoreApi } from 'zustand'

import type { ExplorerEntry, ExplorerFsEvent } from '../../../electron/store/types'
import type { GitStatusSnapshot, GitStatusCategory } from '../../../shared/git'
import type { LspDiagnosticsEvent } from '../../../shared/lsp'
import type { SidebarMode } from './constants'

export type DirEntriesMap = Record<string, ExplorerEntry[]>
export type FlagMap = Record<string, boolean>
export type DiagnosticMap = Record<string, number>

export interface ExplorerTreeRow {
  id: string
  name: string
  type: 'file' | 'folder'
  level: number
  path: string | null
  normalizedPath: string | null
  parentPath: string | null
  isOpen?: boolean
  isLoading?: boolean
  gitStatus?: GitStatusCategory | null
  diagnosticSeverity?: number | null
}

export interface ExplorerClipboardEntry {
  name: string
  path: string | null
  normalizedPath: string | null
  type: 'file' | 'folder'
  parentPath: string | null
}

export interface ExplorerClipboardState {
  mode: 'copy' | 'cut'
  entries: ExplorerClipboardEntry[]
  createdAt: number
}

export interface ExplorerDragState {
  paths: string[]
}

export interface ExplorerContextMenuState {
  isOpen: boolean
  x: number
  y: number
  target: ExplorerTreeRow | null
}

export type ExplorerContextAction =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'copy'
  | 'cut'
  | 'paste'

export interface GitDecoration {
  category: GitStatusCategory
  staged: boolean
  unstaged: boolean
}

export interface ExplorerBaseSlice {
  workspaceRoot: string | null
  normalizedRoot: string | null
  entriesByDir: DirEntriesMap
  loadedDirs: FlagMap
  loadingDirs: FlagMap
  expanded: FlagMap
  treeRows: ExplorerTreeRow[]
  rowMap: Record<string, ExplorerTreeRow>
  rowIndexById: Record<string, number>
  gitStatusByPath: Record<string, GitDecoration>
  diagnosticSources: DiagnosticMap
  diagnosticsByPath: DiagnosticMap
  lastError: string | null
  isHydrating: boolean

  hydrate: () => Promise<void>
  refreshDirectory: (dirPath?: string, opts?: { force?: boolean }) => Promise<void>
  expandDirectory: (dirPath: string, opts?: { force?: boolean }) => Promise<void>
  collapseDirectory: (dirPath: string) => void
  toggleDirectory: (dirPath: string) => Promise<void>
  handleFsEvent: (event: ExplorerFsEvent) => void
  openFileInEditor: (filePath: string, opts?: { mode?: 'preview' | 'pinned' }) => Promise<void>
  resetForWorkspace: (workspaceRoot: string | null) => void
  reloadPersistedState: () => void
  refreshGitStatus: () => Promise<void>
  applyGitStatusSnapshot: (snapshot: GitStatusSnapshot) => void
  applyDiagnosticsFromLsp: (payload: LspDiagnosticsEvent) => void
}

export interface ExplorerSelectionSlice {
  selectedRowIds: string[]
  selectedLookup: Record<string, boolean>
  selectionAnchorId: string | null
  dropTargetId: string | null
  clipboard: ExplorerClipboardState | null
  dragState: ExplorerDragState | null

  prepareSelectionForContextMenu: (target: ExplorerTreeRow | null) => void
  handleRowPointerDown: (row: ExplorerTreeRow, modifiers?: { metaKey?: boolean; shiftKey?: boolean }) => void
  clearSelection: () => void
  resetSelectionState: () => void
  beginDrag: (row: ExplorerTreeRow) => void
  endDrag: () => void
  setDropTarget: (rowId: string | null) => void
  handleDropOnTarget: (target: ExplorerTreeRow | null, opts?: { copy?: boolean }) => Promise<void>
  setClipboardFromRows: (mode: 'copy' | 'cut', rows: ExplorerTreeRow[]) => void
  clearClipboardState: () => void
}

export interface ExplorerContextMenuSlice {
  contextMenu: ExplorerContextMenuState
  showContextMenu: (target: ExplorerTreeRow | null, position: { x: number; y: number }) => void
  hideContextMenu: () => void
  invokeContextAction: (action: ExplorerContextAction, target?: ExplorerTreeRow | null) => Promise<void>
}

export interface ExplorerSidebarSlice {
  sidebarWidth: number
  openFilesPaneHeight: number
  sidebarMode: SidebarMode
  setSidebarWidth: (width: number) => void
  setOpenFilesPaneHeight: (height: number) => void
  setSidebarMode: (mode: SidebarMode) => void
}

export type ExplorerStore = ExplorerBaseSlice & ExplorerSelectionSlice & ExplorerContextMenuSlice & ExplorerSidebarSlice
export type ExplorerStoreApi = StoreApi<ExplorerStore>
export type ExplorerStoreSetter = ExplorerStoreApi['setState']
export type ExplorerStoreGetter = ExplorerStoreApi['getState']
