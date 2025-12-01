/**
 * WorkspaceSearchViewer - Displays workspace search results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeWorkspaceSearchContent } from '../../../BadgeWorkspaceSearchContent'

interface WorkspaceSearchViewerProps {
  badge: BadgeType
}

export function WorkspaceSearchViewer({ badge }: WorkspaceSearchViewerProps) {
  // Use existing BadgeWorkspaceSearchContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeWorkspaceSearchContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

