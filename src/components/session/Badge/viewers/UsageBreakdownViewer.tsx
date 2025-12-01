/**
 * UsageBreakdownViewer - Displays token usage breakdown
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeUsageBreakdownContent } from '../../../BadgeUsageBreakdownContent'

interface UsageBreakdownViewerProps {
  badge: BadgeType
}

export function UsageBreakdownViewer({ badge }: UsageBreakdownViewerProps) {
  // Use existing BadgeUsageBreakdownContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeUsageBreakdownContent
        badgeId={badge.id}
        usageKey={badge.interactive.data.key}
      />
    )
  }

  return null
}

