/**
 * WorkspaceJumpViewer - Displays workspace jump results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeWorkspaceJumpContent } from '../../../BadgeWorkspaceJumpContent'

interface WorkspaceJumpViewerProps {
  badge: BadgeType
}

export function WorkspaceJumpViewer({ badge }: WorkspaceJumpViewerProps) {
  // Use existing BadgeWorkspaceJumpContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeWorkspaceJumpContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

