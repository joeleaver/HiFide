/**
 * ErrorViewer - Displays error messages for error badges
 */

import { Text } from '@mantine/core'
import type { Badge as BadgeType } from '../../../../../electron/store/types'

interface ErrorViewerProps {
  badge: BadgeType
}

export function ErrorViewer({ badge }: ErrorViewerProps) {
  return (
    <div style={{ padding: '12px' }}>
      <Text size="xs" c="red.4" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {badge.error || 'An error occurred'}
      </Text>
    </div>
  )
}

