/**
 * BadgeContainer - Expandable container for badges
 * Handles expansion state and provides consistent border/styling
 */

import { ReactNode } from 'react'
import type { Badge as BadgeType } from '../../../../electron/store/types'

interface BadgeContainerProps {
  badge: BadgeType
  canExpand: boolean
  children: ReactNode
}

export function BadgeContainer({ badge, canExpand, children }: BadgeContainerProps) {
  return (
    <div
      style={{
        border: '1px solid #3d3d3d',
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: 4,
        marginBottom: 4,
      }}
      data-badge-id={badge.id}
      data-badge-type={badge.type}
      data-can-expand={canExpand}
    >
      {children}
    </div>
  )
}

