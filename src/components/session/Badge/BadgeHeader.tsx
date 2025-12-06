/**
 * BadgeHeader - Consistent header for all badges
 * Shows status indicator, tool name, metadata pills, and expander
 */

import { Group, Text, Badge as MantineBadge, UnstyledButton, useMantineTheme } from '@mantine/core'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useUiStore } from '../../../store/ui'
import type { Badge as BadgeType } from '../../../../electron/store/types'

interface BadgeHeaderProps {
  badge: BadgeType
  simple?: boolean  // Simple rendering for non-expandable badges
}

export function BadgeHeader({ badge, simple }: BadgeHeaderProps) {
  const theme = useMantineTheme()
  const isExpanded = useUiStore((s) => s.expandedBadges?.has(badge.id) ?? (badge.defaultExpanded ?? false))
  const toggleBadgeExpansion = useUiStore((s) => s.toggleBadgeExpansion)

  const canExpand = !simple && badge.expandable

  // Status indicator color
  const statusColor =
    badge.status === 'running' ? '#f97316' :  // Orange
    badge.status === 'error' ? '#ef4444' :     // Red
    badge.status === 'success' ? '#10b981' :   // Green
    '#6b7280'  // Gray fallback

  const handleToggle = () => {
    if (!canExpand) return
    toggleBadgeExpansion(badge.id)
  }

  // Simple badge rendering (no expansion)
  if (simple) {
    return (
      <MantineBadge
        color={badge.color || 'gray'}
        variant={badge.variant || 'light'}
        size="sm"
        leftSection={badge.icon}
        tt="none"
        style={{ opacity: badge.status === 'running' ? 0.7 : 1 }}
      >
        {badge.label}
        {badge.status === 'running' && ' ...'}
        {badge.status === 'error' && ' ✗'}
      </MantineBadge>
    )
  }

  // Expandable badge header
  return (
    <UnstyledButton
      onClick={handleToggle}
      style={{
        width: '100%',
        padding: '8px 12px',
        background: '#1e1e1e',
        borderBottom: isExpanded ? '1px solid #3d3d3d' : 'none',
        cursor: canExpand ? 'pointer' : 'default',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (canExpand) e.currentTarget.style.background = '#252526'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#1e1e1e'
      }}
    >
      <Group gap={8} wrap="nowrap" justify="space-between">
        {/* Left: Status + Tool Name */}
        <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {/* Status Indicator */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: statusColor,
              flexShrink: 0,
              boxShadow: badge.status === 'running' ? `0 0 8px ${statusColor}` : 'none',
            }}
          />

          {/* Tool Name Badge */}
          {badge.toolName && (
            <MantineBadge 
              size="xs" 
              variant="light" 
              color="gray" 
              radius="sm" 
              tt="uppercase" 
              style={{ flexShrink: 0, opacity: 0.9, letterSpacing: 0.5 }}
            >
              {badge.toolName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}
            </MantineBadge>
          )}

          {/* Tool Name */}
          <Text
            size="xs"
            fw={600}
            c="gray.3"
            style={{
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {badge.label}
          </Text>

          {/* Metadata (file count, etc.) */}
          {badge.metadata?.fileCount && (
            <Text size="xs" c="dimmed">
              {badge.metadata.fileCount} {badge.metadata.fileCount === 1 ? 'file' : 'files'}
            </Text>
          )}
          {badge.metadata?.resultCount && (
            <Text size="xs" c="dimmed">
              {badge.metadata.resultCount} {badge.metadata.resultCount === 1 ? 'result' : 'results'}
            </Text>
          )}
        </Group>

        {/* Right: Pills + Expander */}
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Added Lines Pill */}
          {typeof badge.addedLines === 'number' && (
            <MantineBadge
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
            </MantineBadge>
          )}

          {/* Removed Lines Pill */}
          {typeof badge.removedLines === 'number' && (
            <MantineBadge
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
            </MantineBadge>
          )}

          {/* Expander Icon */}
          {canExpand && (
            isExpanded ? (
              <IconChevronUp size={14} color={theme.colors.gray[5]} />
            ) : (
              <IconChevronDown size={14} color={theme.colors.gray[5]} />
            )
          )}
        </Group>
      </Group>
    </UnstyledButton>
  )
}

