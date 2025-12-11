import type { StateCreator } from 'zustand'

import { getBackendClient } from '@/lib/backend/bootstrap'

import { CLIPBOARD_TTL_MS } from './constants'
import type {
  ExplorerClipboardEntry,
  ExplorerClipboardState,
  ExplorerSelectionSlice,
  ExplorerStore,
  ExplorerTreeRow,
} from './types'
import { buildSelectionLookup } from './treeSnapshot'
import { getParentFsPath, normalizeFsPath, pathsEqual } from '../utils/fsPath'

let clipboardExpiryTimer: ReturnType<typeof setTimeout> | null = null

export const createExplorerSelectionSlice: StateCreator<ExplorerStore, [], [], ExplorerSelectionSlice> = (set, get) => {
  const applySelection = (ids: string[], anchorId?: string | null) => {
    const rowMap = get().rowMap
    const uniqueIds = Array.from(new Set(ids.filter((id) => !!rowMap[id])))
    set({
      selectedRowIds: uniqueIds,
      selectedLookup: buildSelectionLookup(uniqueIds),
      selectionAnchorId: anchorId ?? (uniqueIds[0] ?? null),
    })
  }

  const clearSelectionState = () => {
    if (!get().selectedRowIds.length) return
    set({ selectedRowIds: [], selectedLookup: {}, selectionAnchorId: null })
  }

  const setClipboard = (value: ExplorerClipboardState | null) => {
    if (clipboardExpiryTimer) {
      clearTimeout(clipboardExpiryTimer)
      clipboardExpiryTimer = null
    }
    const nextValue = value && Array.isArray(value.entries) && value.entries.length ? value : null
    set({ clipboard: nextValue })
    if (nextValue) {
      clipboardExpiryTimer = setTimeout(() => {
        clipboardExpiryTimer = null
        set((state) => (state.clipboard ? { clipboard: null } : state))
      }, CLIPBOARD_TTL_MS)
    }
  }

  return {
    selectedRowIds: [],
    selectedLookup: {},
    selectionAnchorId: null,
    dropTargetId: null,
    clipboard: null,
    dragState: null,

    prepareSelectionForContextMenu: (target) => {
      if (!target) {
        clearSelectionState()
        return
      }
      if (!target.id) return
      if (get().selectedLookup[target.id]) return
      applySelection([target.id], target.id)
    },

    handleRowPointerDown: (row, modifiers) => {
      if (!row?.id) return
      const state = get()
      const metaKey = Boolean(modifiers?.metaKey)
      const shiftKey = Boolean(modifiers?.shiftKey)
      if (shiftKey) {
        const anchorId = state.selectionAnchorId ?? row.id
        const rangeIds = buildRangeSelectionIds(state, anchorId, row.id)
        applySelection(rangeIds, anchorId)
        return
      }
      if (metaKey) {
        if (state.selectedLookup[row.id]) {
          const remaining = state.selectedRowIds.filter((id) => id !== row.id)
          applySelection(remaining, state.selectionAnchorId === row.id ? remaining[0] ?? null : state.selectionAnchorId)
        } else {
          applySelection([...state.selectedRowIds, row.id], state.selectionAnchorId ?? row.id)
        }
        return
      }
      applySelection([row.id], row.id)
    },

    clearSelection: () => {
      clearSelectionState()
    },

    resetSelectionState: () => {
      clearSelectionState()
      set({ dropTargetId: null, dragState: null })
    },

    beginDrag: (row) => {
      if (!row?.path || isRootRow(row)) return
      const state = get()
      if (!state.selectedLookup[row.id]) {
        applySelection([row.id], row.id)
      }
      const currentState = get()
      const dragRows = collectSelectedRows(currentState)
      const paths = (dragRows.length ? dragRows : [row])
        .map((entry) => entry.path)
        .filter((value): value is string => typeof value === 'string')
      if (!paths.length) return
      set({ dragState: { paths }, dropTargetId: null })
    },

    endDrag: () => {
      if (!get().dragState && !get().dropTargetId) return
      set({ dragState: null, dropTargetId: null })
    },

    setDropTarget: (rowId) => {
      set({ dropTargetId: rowId })
    },

    handleDropOnTarget: async (target, opts) => {
      const dragPaths = get().dragState?.paths ?? []
      if (!dragPaths.length) return
      const destinationDir = target?.type === 'folder' && target.path ? target.path : get().workspaceRoot
      if (!destinationDir) {
        set({ dropTargetId: null })
        return
      }
      if (dragPaths.some((source) => isDescendantPath(destinationDir, source))) {
        set({ dropTargetId: null, dragState: null })
        return
      }

      const client = getBackendClient()
      if (!client) throw new Error('No backend connection')
      const mode: 'copy' | 'cut' = opts?.copy ? 'copy' : 'cut'
      const res: any = await client.rpc('explorer.pasteEntries', {
        sources: dragPaths,
        destination: destinationDir,
        mode,
      })
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to move entries')
      }
      await get().refreshDirectory(destinationDir, { force: true })
      if (mode === 'cut') {
        const parentDirs = new Set<string>()
        for (const source of dragPaths) {
          const parent = getParentFsPath(source)
          if (parent) parentDirs.add(parent)
        }
        for (const dir of parentDirs) {
          await get().refreshDirectory(dir, { force: true })
        }
      }
      set({ dropTargetId: null, dragState: null })
    },

    setClipboardFromRows: (mode, rows) => {
      if (!rows.length) {
        setClipboard(null)
        return
      }
      const entries = rows.map((row) => serializeClipboardEntry(row)).filter(Boolean) as ExplorerClipboardEntry[]
      setClipboard({ mode, entries, createdAt: Date.now() })
    },

    clearClipboardState: () => {
      setClipboard(null)
    },
  }
}

export function collectSelectedRows(state: ExplorerStore, opts: { includeRoot?: boolean } = {}): ExplorerTreeRow[] {
  const rows: ExplorerTreeRow[] = []
  for (const id of state.selectedRowIds) {
    const row = state.rowMap[id]
    if (!row || !row.path) continue
    if (!opts.includeRoot && isRootRow(row)) continue
    rows.push(row)
  }
  return rows
}

function buildRangeSelectionIds(state: ExplorerStore, anchorId: string, targetId: string): string[] {
  const anchorIndex = state.rowIndexById[anchorId]
  const targetIndex = state.rowIndexById[targetId]
  if (anchorIndex == null || targetIndex == null) {
    return [targetId]
  }
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  const ids: string[] = []
  for (let i = start; i <= end; i += 1) {
    const rowId = state.treeRows[i]?.id
    if (rowId) ids.push(rowId)
  }
  return ids
}

export function serializeClipboardEntry(row: ExplorerTreeRow): ExplorerClipboardEntry {
  return {
    name: row.name,
    path: row.path ?? null,
    normalizedPath: row.normalizedPath ?? null,
    type: row.type,
    parentPath: row.parentPath,
  }
}

export function isRootRow(row: ExplorerTreeRow | null): boolean {
  return !!row && row.parentPath === null
}

function isDescendantPath(candidate: string, ancestor: string): boolean {
  const normalizedCandidate = normalizeFsPath(candidate)
  const normalizedAncestor = normalizeFsPath(ancestor)
  if (!normalizedCandidate || !normalizedAncestor) return false
  if (pathsEqual(normalizedCandidate, normalizedAncestor)) return true
  return normalizedCandidate.startsWith(normalizedAncestor.endsWith('/') ? normalizedAncestor : `${normalizedAncestor}/`)
}
