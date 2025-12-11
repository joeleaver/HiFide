import type { ExplorerStore, ExplorerTreeRow, ExplorerStoreSetter, FlagMap } from './types'
import { getBasename, normalizeFsPath } from '../utils/fsPath'

export function recomputeTreeSnapshot(set: ExplorerStoreSetter, get: () => ExplorerStore): void {
  const snapshot = buildTreeSnapshot(get())
  set((state) => {
    const validSelected = state.selectedRowIds.filter((id) => Boolean(snapshot.rowMap[id]))
    const selectedLookup = buildSelectionLookup(validSelected)
    const anchorStillValid = state.selectionAnchorId && snapshot.rowMap[state.selectionAnchorId]
    const dropTargetStillValid = state.dropTargetId && snapshot.rowMap[state.dropTargetId]
    return {
      treeRows: snapshot.rows,
      rowMap: snapshot.rowMap,
      rowIndexById: snapshot.rowIndexById,
      selectedRowIds: validSelected,
      selectedLookup,
      selectionAnchorId: anchorStillValid ? state.selectionAnchorId : validSelected[0] ?? null,
      dropTargetId: dropTargetStillValid ? state.dropTargetId : null,
    }
  })
}

export function buildTreeSnapshot(state: ExplorerStore): {
  rows: ExplorerTreeRow[]
  rowMap: Record<string, ExplorerTreeRow>
  rowIndexById: Record<string, number>
} {
  const rows = buildTreeRows(state)
  const rowMap: Record<string, ExplorerTreeRow> = {}
  const rowIndexById: Record<string, number> = {}
  rows.forEach((row, index) => {
    rowMap[row.id] = row
    rowIndexById[row.id] = index
  })
  return { rows, rowMap, rowIndexById }
}

export function buildTreeRows(state: ExplorerStore): ExplorerTreeRow[] {
  const rows: ExplorerTreeRow[] = []
  const { workspaceRoot, normalizedRoot } = state
  if (!workspaceRoot || !normalizedRoot) {
    return rows
  }

  const rootName = getBasename(workspaceRoot) || workspaceRoot
  const rootOpen = !!state.expanded[normalizedRoot]
  const rootRow: ExplorerTreeRow = {
    id: normalizedRoot,
    name: rootName,
    type: 'folder',
    level: 0,
    path: workspaceRoot,
    normalizedPath: normalizedRoot,
    parentPath: null,
    isOpen: rootOpen,
    isLoading: !!state.loadingDirs[normalizedRoot],
    gitStatus: state.gitStatusByPath[normalizedRoot]?.category ?? null,
    diagnosticSeverity: state.diagnosticsByPath[normalizedRoot] ?? null,
  }
  rows.push(rootRow)

  if (rootOpen) {
    appendChildRows(rows, state, workspaceRoot, normalizedRoot, 1)
  }

  return rows
}

function appendChildRows(
  rows: ExplorerTreeRow[],
  state: ExplorerStore,
  parentPath: string,
  parentNormalized: string,
  level: number
): void {
  const entries = state.entriesByDir[parentNormalized]
  if (!entries?.length) return

  for (const entry of entries) {
    const entryPath = entry.path ?? buildChildPath(parentPath, entry.name)
    const normalizedEntryPath = normalizeFsPath(entryPath)
    const baseId = normalizedEntryPath ?? `${parentNormalized}:${entry.name}:${entry.isDirectory ? 'dir' : 'file'}`

    if (entry.isDirectory) {
      const isOpen = normalizedEntryPath ? !!state.expanded[normalizedEntryPath] : false
      const isLoading = normalizedEntryPath ? !!state.loadingDirs[normalizedEntryPath] : false
      rows.push({
        id: baseId,
        name: entry.name,
        type: 'folder',
        level,
        path: entryPath,
        normalizedPath: normalizedEntryPath,
        parentPath,
        isOpen,
        isLoading,
        gitStatus: normalizedEntryPath ? state.gitStatusByPath[normalizedEntryPath]?.category ?? null : null,
        diagnosticSeverity: normalizedEntryPath ? state.diagnosticsByPath[normalizedEntryPath] ?? null : null,
      })
      if (isOpen && entryPath && normalizedEntryPath) {
        appendChildRows(rows, state, entryPath, normalizedEntryPath, level + 1)
      }
    } else {
      rows.push({
        id: baseId,
        name: entry.name,
        type: 'file',
        level,
        path: entryPath,
        normalizedPath: normalizedEntryPath,
        parentPath,
        gitStatus: normalizedEntryPath ? state.gitStatusByPath[normalizedEntryPath]?.category ?? null : null,
        diagnosticSeverity: normalizedEntryPath ? state.diagnosticsByPath[normalizedEntryPath] ?? null : null,
      })
    }
  }
}

function buildChildPath(parent: string, child: string): string {
  if (!parent) return child
  const separator = parent.includes('\\') ? '\\' : '/'
  if (parent.endsWith('/') || parent.endsWith('\\')) {
    return `${parent}${child}`
  }
  return `${parent}${separator}${child}`
}

export function buildExpandedMap(paths?: string[]): FlagMap {
  const map: FlagMap = {}
  if (!Array.isArray(paths)) return map
  for (const value of paths) {
    const key = normalizeFsPath(value)
    if (key) map[key] = true
  }
  return map
}

export function ensureRootExpanded(map: FlagMap, normalizedRoot: string | null): FlagMap {
  if (!normalizedRoot) return map
  if (map[normalizedRoot]) return map
  return { ...map, [normalizedRoot]: true }
}

export function buildSelectionLookup(ids: string[]): Record<string, boolean> {
  const lookup: Record<string, boolean> = {}
  for (const id of ids) {
    lookup[id] = true
  }
  return lookup
}
