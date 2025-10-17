import { Group, Text, Badge, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { usePanelResize } from '../hooks/usePanelResize'
import { ReactNode } from 'react'

interface CollapsiblePanelProps {
  title: string
  collapsed: boolean
  onToggleCollapse: () => void
  height: number
  onHeightChange: (height: number) => void
  minHeight?: number
  maxHeight?: number
  badge?: string | number
  children: ReactNode
  actions?: ReactNode  // Optional action buttons in header
}

export default function CollapsiblePanel({
  title,
  collapsed,
  onToggleCollapse,
  height,
  onHeightChange,
  minHeight = 150,
  maxHeight = 600,
  badge,
  children,
  actions,
}: CollapsiblePanelProps) {
  // Resize handler (handle at top) - now uses local height directly
  const { onMouseDown, isResizingRef } = usePanelResize({
    initialHeight: height,
    setHeight: onHeightChange,
    min: minHeight,
    max: maxHeight,
    handlePosition: 'top',
  })

  return (
    <div
      style={{
        borderTop: '1px solid #3e3e42',
        height: collapsed ? 'auto' : `${height}px`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Resize handle - only show when not collapsed */}
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            cursor: 'ns-resize',
            backgroundColor: 'transparent',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#007acc'
          }}
          onMouseLeave={(e) => {
            if (!isResizingRef.current) {
              e.currentTarget.style.backgroundColor = 'transparent'
            }
          }}
        />
      )}

      {/* Header bar - always visible */}
      <div
        style={{
          padding: collapsed ? '6px 12px' : '6px 12px 5px 12px',
          borderBottom: collapsed ? 'none' : '1px solid #3e3e42',
          backgroundColor: '#252526',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">
            {title}
          </Text>
          {badge !== undefined && (
            <Badge size="xs" variant="light" color="gray">
              {badge}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          {actions}
          <UnstyledButton
            onClick={onToggleCollapse}
            style={{
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#888'
            }}
          >
            {collapsed ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </UnstyledButton>
        </Group>
      </div>

      {/* Content area - hidden when collapsed */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden', backgroundColor: '#1e1e1e' }}>
          {children}
        </div>
      )}
    </div>
  )
}

