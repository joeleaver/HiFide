/**
 * Unified Badge Component
 * 
 * Single reusable component for all tool execution badges in the session timeline.
 * Handles consistent rendering, expansion/collapse, and delegates content rendering
 * to specialized viewers based on tool type.
 */

import { memo } from 'react'
import type { Badge as BadgeType } from '../../../../electron/store/types'
import { BadgeContainer } from './BadgeContainer'
import { BadgeHeader } from './BadgeHeader'
import { BadgeContent } from './BadgeContent'

interface BadgeProps {
  badge: BadgeType
}

/**
 * Main Badge component - renders tool execution badges with consistent UI
 */
export const Badge = memo(function Badge({ badge }: BadgeProps) {
  // Simple badges (intent, cache, custom) - no expansion
  if (badge.type === 'intent' || badge.type === 'cache' || badge.type === 'custom') {
    return <BadgeHeader badge={badge} simple />
  }

  // Tool and error badges - expandable with content
  const canExpand = Boolean(badge.expandable && (badge.contentType || badge.toolName))

  return (
    <BadgeContainer badge={badge} canExpand={canExpand}>
      <BadgeHeader badge={badge} />
      {canExpand && <BadgeContent badge={badge} />}
    </BadgeContainer>
  )
})

