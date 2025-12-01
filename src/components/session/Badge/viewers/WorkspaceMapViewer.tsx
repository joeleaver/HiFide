/**
 * WorkspaceMapViewer - Displays workspace map results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeWorkspaceMapContent } from '../../../BadgeWorkspaceMapContent'

interface WorkspaceMapViewerProps {
  badge: BadgeType
}

export function WorkspaceMapViewer({ badge }: WorkspaceMapViewerProps) {
  // Use existing BadgeWorkspaceMapContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeWorkspaceMapContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

