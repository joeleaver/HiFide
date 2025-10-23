import { ReactNode, useEffect } from 'react'
import { Group, Text, Badge, UnstyledButton, useMantineTheme } from '@mantine/core'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useUiStore } from '../store/ui'
import { useAppStore, useDispatch } from '../store'
import type { Badge as BadgeType } from '../../electron/store/types'

interface ToolBadgeContainerProps {
  badge: BadgeType
  children?: ReactNode  // Expanded content
}

/**
 * Expandable container for tool badges
 * Replaces simple badges with a sophisticated header + collapsible content area
 */
export default function ToolBadgeContainer({ badge, children }: ToolBadgeContainerProps) {
  console.log('[ToolBadgeContainer] Component rendering:', badge.id)

  const theme = useMantineTheme()
  const dispatch = useDispatch()
  const expandedBadges = useUiStore((s) => s.expandedBadges)
  const toggleBadgeExpansion = useUiStore((s) => s.toggleBadgeExpansion)
  const openInlineDiffForBadge = useUiStore((s) => s.openInlineDiffForBadge)
  const inlineDiffByBadge = useUiStore((s) => s.inlineDiffByBadge)

  // Use expandedBadges state if available, otherwise fall back to defaultExpanded
  // Note: We check expandedBadges first because user interaction should override defaults
  const isExpanded = expandedBadges ? expandedBadges.has(badge.id) : (badge.defaultExpanded ?? false)
  const canExpand = !!(badge.expandable && children)

  // Status indicator color
  const statusColor =
    badge.status === 'running' ? '#f97316' :  // Orange
    badge.status === 'error' ? '#ef4444' :     // Red
    badge.status === 'success' ? '#10b981' :   // Green
    '#6b7280'  // Gray fallback

  // Load diff data when expanded (for diff badges)
  useEffect(() => {
    if (isExpanded && badge.contentType === 'diff' && badge.interactive?.type === 'diff') {
      const payload = badge.interactive.data
      const existing = inlineDiffByBadge[badge.id]

      // If we already have cached data, nothing to do
      if (existing && existing.length) {
        return
      }

      // Load diff data from main process cache
      if (payload && typeof payload === 'object' && payload.key) {
        // Note: do NOT include `dispatch` in deps to avoid re-runs from identity changes
        dispatch('loadDiffPreview', { key: payload.key }).then(() => {
          const files = (useAppStore as any).getState().feLatestDiffPreview || []
          if (files.length) {
            openInlineDiffForBadge(badge.id, files)
          }
        }).catch((e: any) => {
          console.error('Failed to load diff preview:', e)
        })
      } else if (Array.isArray(payload)) {
        // Direct payload (legacy)
        openInlineDiffForBadge(badge.id, payload)
      }
    }
  }, [isExpanded, badge.id, badge.contentType, badge.interactive, openInlineDiffForBadge, inlineDiffByBadge])

  const handleToggle = () => {
    console.log('[ToolBadgeContainer] handleToggle called:', {
      badgeId: badge.id,
      canExpand,
      currentlyExpanded: isExpanded
    })
    if (!canExpand) return
    toggleBadgeExpansion(badge.id)
  }

  return (
    <div
      style={{
        border: '1px solid #3d3d3d',
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: '#2d2d2d',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: canExpand ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={handleToggle}
      >
        {/* Status Indicator Light */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 4px ${statusColor}`,
            flexShrink: 0,
          }}
        />

        {/* Tool Name */}
        <Text
          size="xs"
          fw={700}
          tt="uppercase"
          style={{
            letterSpacing: '0.5px',
            color: '#e5e5e5',
            flexShrink: 0,
          }}
        >
          {badge.label}
        </Text>

        {/* Metadata Area */}
        <Group gap={6} style={{ flex: 1, flexWrap: 'wrap' }}>
          {/* File path (shown for single file edits or fs.* tools) */}
          {badge.metadata?.filePath && (
            <Text
              size="xs"
              c="dimmed"
              style={{
                maxWidth: 300,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {badge.metadata.filePath}
            </Text>
          )}

          {/* File count (only shown for multi-file edits when no filePath) */}
          {badge.metadata?.fileCount !== undefined && !badge.metadata?.filePath && badge.metadata.fileCount > 1 && (
            <Text size="xs" c="dimmed">
              {badge.metadata.fileCount} files
            </Text>
          )}

          {/* Result count (for search tools) */}
          {badge.metadata?.resultCount !== undefined && (
            <Text size="xs" c="dimmed">
              {badge.metadata.resultCount} {badge.metadata.resultCount === 1 ? 'result' : 'results'}
            </Text>
          )}

          {/* Query for search tools */}
          {badge.metadata?.query && (
            <Text
              size="xs"
              c="dimmed"
              style={{
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              "{badge.metadata.query}"
            </Text>
          )}

          {/* Duration */}
          {badge.metadata?.duration !== undefined && (
            <Text size="xs" c="dimmed">
              {badge.metadata.duration}ms
            </Text>
          )}
        </Group>

        {/* Pills Area */}
        <Group gap={4} style={{ flexShrink: 0 }}>
          {typeof badge.addedLines === 'number' && (
            <Badge
              size="xs"
              style={{
                padding: '0 6px',
                height: 16,
                lineHeight: '16px',
                borderRadius: 9999,
                border: '1px solid rgba(255,255,255,0.25)',
                background: theme.colors.green[8],
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.3,
              }}
            >
              +{badge.addedLines}
            </Badge>
          )}

          {typeof badge.removedLines === 'number' && (
            <Badge
              size="xs"
              style={{
                padding: '0 6px',
                height: 16,
                lineHeight: '16px',
                borderRadius: 9999,
                border: '1px solid rgba(255,255,255,0.25)',
                background: theme.colors.red[8],
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.3,
              }}
            >
              -{badge.removedLines}
            </Badge>
          )}

          {badge.filesChanged !== undefined && badge.filesChanged > 1 && (
            <Badge
              size="xs"
              variant="light"
              color="gray"
              style={{
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {badge.filesChanged} files
            </Badge>
          )}
        </Group>

        {/* Expander Icon */}
        {canExpand && (
          <UnstyledButton
            style={{
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              padding: 2,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#888'
            }}
            onClick={(e) => {
              e.stopPropagation()
              handleToggle()
            }}
          >
            {isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </UnstyledButton>
        )}
      </div>

      {/* Expanded Content Area */}
      {canExpand && (
        <div
          style={{
            background: '#1e1e1e',
            borderTop: isExpanded ? '1px solid #3d3d3d' : 'none',
            padding: isExpanded ? 8 : 0,
            maxHeight: isExpanded ? 220 : 0,
            overflow: isExpanded ? 'auto' : 'hidden',
            transition: 'max-height 0.2s ease-in-out, padding 0.2s ease-in-out',
          }}
        >
          {isExpanded && children}
        </div>
      )}
    </div>
  )
}

