import { memo, useCallback, useEffect, useRef } from 'react'
import { Stack } from '@mantine/core'

import { useExplorerStore, type ExplorerContextAction } from '@/store/explorer'

const ExplorerContextMenu = memo(function ExplorerContextMenu() {
  const contextMenu = useExplorerStore((s) => s.contextMenu)
  const clipboard = useExplorerStore((s) => s.clipboard)
  const hideContextMenu = useExplorerStore((s) => s.hideContextMenu)
  const invokeContextAction = useExplorerStore((s) => s.invokeContextAction)
  const selectionMeta = useExplorerStore(
    useCallback((state) => {
      let actionable = 0
      for (const id of state.selectedRowIds) {
        const row = state.rowMap[id]
        if (row && row.path && row.parentPath !== null) {
          actionable += 1
        }
      }
      return { total: state.selectedRowIds.length, actionable }
    }, [])
  )
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!contextMenu.isOpen) return
    const handlePointer = (event: MouseEvent | WheelEvent) => {
      const target = event.target as Node | null
      if (target && menuRef.current?.contains(target)) {
        return
      }
      hideContextMenu()
    }
    const handleBlur = () => hideContextMenu()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        hideContextMenu()
      }
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('wheel', handlePointer)
    window.addEventListener('contextmenu', handlePointer)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('wheel', handlePointer)
      window.removeEventListener('contextmenu', handlePointer)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu.isOpen, hideContextMenu])

  if (!contextMenu.isOpen) return null

  const target = contextMenu.target
  const hasTarget = Boolean(target && target.path)
  const isRoot = Boolean(target && target.parentPath === null)
  const hasClipboard = Boolean(clipboard?.entries?.length)
  const effectiveSelectionCount = selectionMeta.total || (hasTarget ? 1 : 0)
  const effectiveActionableCount = selectionMeta.actionable || (hasTarget && !isRoot ? 1 : 0)

  const menuItems: Array<{ key: string; label?: string; action?: ExplorerContextAction; disabled?: boolean; divider?: boolean }> = [
    { key: 'new-file', label: 'New File', action: 'new-file', disabled: false },
    { key: 'new-folder', label: 'New Folder', action: 'new-folder', disabled: false },
    { key: 'divider-1', divider: true },
    { key: 'rename', label: 'Rename', action: 'rename', disabled: !hasTarget || isRoot || effectiveSelectionCount !== 1 },
    { key: 'duplicate', label: 'Duplicate', action: 'duplicate', disabled: !hasTarget || effectiveSelectionCount !== 1 },
    { key: 'delete', label: 'Delete', action: 'delete', disabled: effectiveActionableCount === 0 },
    { key: 'divider-2', divider: true },
    { key: 'copy', label: 'Copy', action: 'copy', disabled: effectiveActionableCount === 0 },
    { key: 'cut', label: 'Cut', action: 'cut', disabled: effectiveActionableCount === 0 },
    { key: 'paste', label: 'Paste', action: 'paste', disabled: !hasClipboard },
  ]

  return (
    <div
      ref={menuRef}
      className="explorer-context-menu"
      style={{ top: contextMenu.y, left: contextMenu.x }}
    >
      <Stack gap={0}>
        {menuItems.map((item) => {
          if (item.divider) {
            return <div key={item.key} className="explorer-context-menu-divider" />
          }
          const actionId = item.action
          if (!actionId) return null
          return (
            <button
              key={item.key}
              type="button"
              className="explorer-context-menu-item"
              data-disabled={item.disabled ? 'true' : undefined}
              onClick={() => {
                if (item.disabled) return
                void invokeContextAction(actionId, target ?? null)
              }}
            >
              {item.label}
            </button>
          )
        })}
      </Stack>
    </div>
  )
})

export default ExplorerContextMenu
