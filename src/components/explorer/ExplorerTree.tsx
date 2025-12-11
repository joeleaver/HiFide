import { memo, useMemo } from 'react'
import type { MouseEventHandler, DragEventHandler } from 'react'
import { ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronRight, IconChevronDown, IconFolder, IconFile } from '@tabler/icons-react'

import { useExplorerStore, type ExplorerTreeRow } from '@/store/explorer'
import { useEditorStore } from '@/store/editor'
import { normalizeFsPath, pathsEqual } from '@/store/utils/fsPath'
import { getFileIconDescriptor } from '@/lib/explorer/fileIcons'

const FileTreeItem = memo(function FileTreeItem({ row }: { row: ExplorerTreeRow }) {
  const handlePointerDown = useExplorerStore((s) => s.handleRowPointerDown)
  const beginDrag = useExplorerStore((s) => s.beginDrag)
  const endDrag = useExplorerStore((s) => s.endDrag)
  const setDropTarget = useExplorerStore((s) => s.setDropTarget)
  const handleDropOnTarget = useExplorerStore((s) => s.handleDropOnTarget)
  const toggleDirectory = useExplorerStore((s) => s.toggleDirectory)
  const openFileInEditor = useExplorerStore((s) => s.openFileInEditor)
  const showContextMenu = useExplorerStore((s) => s.showContextMenu)
  const prepareSelectionForContextMenu = useExplorerStore((s) => s.prepareSelectionForContextMenu)

  const normalizedPath = useMemo(() => row.normalizedPath ?? (row.path ? normalizeFsPath(row.path) : null), [row.normalizedPath, row.path])
  const isActive = useEditorStore(
    useMemo(
      () => (state: ReturnType<typeof useEditorStore.getState>) => {
        if (!normalizedPath) return false
        return state.activeTabId === normalizedPath
      },
      [normalizedPath]
    )
  )
  const isSelected = useExplorerStore(
    useMemo(() => (state: ReturnType<typeof useExplorerStore.getState>) => !!state.selectedLookup[row.id], [row.id])
  )
  const isDropTarget = useExplorerStore(
    useMemo(() => (state: ReturnType<typeof useExplorerStore.getState>) => state.dropTargetId === row.id, [row.id])
  )
  const isCutTarget = useExplorerStore(
    useMemo(
      () => (state: ReturnType<typeof useExplorerStore.getState>) => {
        if (!normalizedPath) return false
        const clipboard = state.clipboard
        if (!clipboard || clipboard.mode !== 'cut') return false
        return clipboard.entries.some((entry) => {
          const entryPath = entry.normalizedPath ?? (entry.path ? normalizeFsPath(entry.path) : null)
          return entryPath ? pathsEqual(entryPath, normalizedPath) : false
        })
      },
      [normalizedPath]
    )
  )

  const paddingLeft = 8 + row.level * 14
  const isFolder = row.type === 'folder'
  const isRoot = row.parentPath === null
  const gitStatus = row.gitStatus ?? null
  const diagnosticSeverity = row.diagnosticSeverity ?? null
  const fileIconDescriptor = !isFolder ? getFileIconDescriptor(row.name) : null
  const FileIconComponent = fileIconDescriptor?.icon ?? IconFile

  const handleMouseDown: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    handlePointerDown(row, { metaKey: event.metaKey || event.ctrlKey, shiftKey: event.shiftKey })
  }

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    if (isFolder && row.path) {
      void toggleDirectory(row.path)
    } else if (row.type === 'file' && row.path) {
      void openFileInEditor(row.path, { mode: 'preview' })
    }
  }

  const handleDoubleClick = () => {
    if (row.type === 'file' && row.path) {
      void openFileInEditor(row.path, { mode: 'pinned' })
    } else if (isFolder && row.path) {
      void toggleDirectory(row.path)
    }
  }

  const handleContextMenu: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    prepareSelectionForContextMenu(row)
    showContextMenu(row, { x: event.clientX, y: event.clientY })
  }

  const handleDragStart: DragEventHandler<HTMLButtonElement> = (event) => {
    if (!row.path || isRoot) {
      event.preventDefault()
      return
    }
    beginDrag(row)
    const dragPaths = useExplorerStore.getState().dragState?.paths ?? []
    if (!dragPaths.length) {
      event.preventDefault()
      return
    }
    event.dataTransfer?.setData('text/plain', dragPaths.join('\n'))
    event.dataTransfer?.setData('application/x-hifide-paths', JSON.stringify(dragPaths))
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copyMove'
    }
  }

  const handleDragOver: DragEventHandler<HTMLButtonElement> = (event) => {
    if (!isFolder || !row.path) return
    const dragState = useExplorerStore.getState().dragState
    if (!dragState?.paths.length) return
    event.preventDefault()
    setDropTarget(row.id)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = event.altKey || event.ctrlKey || event.metaKey ? 'copy' : 'move'
    }
  }

  const handleDrop: DragEventHandler<HTMLButtonElement> = (event) => {
    if (!row.path) return
    const dragState = useExplorerStore.getState().dragState
    if (!dragState?.paths.length) return
    event.preventDefault()
    void handleDropOnTarget(row, { copy: event.altKey || event.ctrlKey || event.metaKey })
    endDrag()
  }

  const handleDragLeave: DragEventHandler<HTMLButtonElement> = (event) => {
    const related = event.relatedTarget as Node | null
    if (related && (event.currentTarget as HTMLElement).contains(related)) return
    setDropTarget(null)
  }

  const handleDragEnd: DragEventHandler<HTMLButtonElement> = () => {
    endDrag()
  }

  return (
    <UnstyledButton
      className="explorer-tree-row"
      data-row-id={row.id}
      data-active={isActive ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      data-cut={isCutTarget ? 'true' : undefined}
      data-drop-target={isDropTarget ? 'true' : undefined}
      data-git-status={gitStatus ?? undefined}
      data-diagnostic={diagnosticSeverity ?? undefined}
      draggable={Boolean(row.path) && !isRoot}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
      title={row.path ?? row.name}
      style={{ paddingLeft }}
    >
      {isFolder ? (
        <>
          <span className="explorer-tree-icon explorer-tree-chevron">
            {row.isOpen ? <IconChevronDown size={14} stroke={2} /> : <IconChevronRight size={14} stroke={2} />}
          </span>
          <span className="explorer-tree-icon">
            <IconFolder size={16} stroke={1.5} />
          </span>
        </>
      ) : (
        <>
          <span className="explorer-tree-icon explorer-tree-chevron" />
          <span className="explorer-tree-icon" style={{ color: fileIconDescriptor?.color }}>
            <FileIconComponent size={16} stroke={1.5} />
          </span>
        </>
      )}
      <Text size="sm" className="explorer-tree-label" component="span">
        {row.name}
      </Text>
      <span className="explorer-tree-badges">
        {typeof diagnosticSeverity === 'number' && diagnosticSeverity >= 1 && diagnosticSeverity <= 4 ? (
          <span className="explorer-diagnostic-dot" data-severity={diagnosticSeverity} />
        ) : null}
      </span>
    </UnstyledButton>
  )
})

const ExplorerTree = memo(function ExplorerTree() {
  const treeRows = useExplorerStore((s) => s.treeRows)
  const hasWorkspace = useExplorerStore((s) => Boolean(s.workspaceRoot))
  const clearSelection = useExplorerStore((s) => s.clearSelection)
  const showContextMenu = useExplorerStore((s) => s.showContextMenu)

  return (
    <ScrollArea
      style={{ flex: 1 }}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement | null)?.closest('.explorer-tree-row')) return
        if (event.button !== 0) return
        clearSelection()
      }}
      onContextMenu={(event) => {
        const targetElement = event.target as HTMLElement | null
        if (targetElement?.closest('.explorer-tree-row')) {
          return
        }
        event.preventDefault()
        clearSelection()
        showContextMenu(null, { x: event.clientX, y: event.clientY })
      }}
      onDragOver={(event) => {
        const rowElement = (event.target as HTMLElement | null)?.closest('.explorer-tree-row')
        if (rowElement) return
        const dragState = useExplorerStore.getState().dragState
        if (!dragState?.paths.length) return
        event.preventDefault()
        useExplorerStore.getState().setDropTarget(null)
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = event.altKey || event.ctrlKey || event.metaKey ? 'copy' : 'move'
        }
      }}
      onDrop={(event) => {
        const rowElement = (event.target as HTMLElement | null)?.closest('.explorer-tree-row')
        if (rowElement) return
        const store = useExplorerStore.getState()
        if (!store.dragState?.paths.length) return
        event.preventDefault()
        void store.handleDropOnTarget(null, { copy: event.altKey || event.ctrlKey || event.metaKey })
        store.endDrag()
      }}
    >
      <Stack gap={0} p="xs">
        {treeRows.length > 0 ? (
          treeRows.map((row) => (
            <div key={row.id}>
              <FileTreeItem row={row} />
              {row.type === 'folder' && row.isOpen && row.isLoading && (
                <Text size="xs" c="dimmed" pl={24} py={4}>
                  Loading...
                </Text>
              )}
            </div>
          ))
        ) : hasWorkspace ? (
          <Text size="sm" c="dimmed" p="md">
            Loading workspace…
          </Text>
        ) : (
          <Text size="sm" c="dimmed" p="md">
            No folder selected
          </Text>
        )}
      </Stack>
    </ScrollArea>
  )
})

export default ExplorerTree
