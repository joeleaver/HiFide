import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeWorkspaceMapContent } from '../../../BadgeWorkspaceMapContent'

interface WorkspaceMapViewerProps {
  badge: BadgeType
}

export function WorkspaceMapViewer({ badge }: WorkspaceMapViewerProps) {
  const mapKey = badge.interactive?.data?.key

  if (!mapKey) {
    return null
  }

  return (
    <BadgeWorkspaceMapContent badgeId={badge.id} mapKey={mapKey} />
  )
}
