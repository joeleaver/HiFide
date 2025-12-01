/**
 * JsonViewer - Default fallback viewer for unknown badge types
 * Displays raw badge data as formatted JSON
 */

import { Code } from '@mantine/core'
import type { Badge as BadgeType } from '../../../../../electron/store/types'

interface JsonViewerProps {
  badge: BadgeType
}

export function JsonViewer({ badge }: JsonViewerProps) {
  // Extract relevant data to display
  const data = {
    toolName: badge.toolName,
    status: badge.status,
    metadata: badge.metadata,
    interactive: badge.interactive,
  }

  return (
    <div style={{ padding: '12px' }}>
      <Code
        block
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          maxHeight: 400,
          overflow: 'auto',
          background: '#0d0d0d',
          border: '1px solid #2d2d2d',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </Code>
    </div>
  )
}

