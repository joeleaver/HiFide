/**
 * KBStoreViewer - Displays knowledge base store results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeKnowledgeBaseStoreContent } from '../../../BadgeKnowledgeBaseStoreContent'

interface KBStoreViewerProps {
  badge: BadgeType
}

export function KBStoreViewer({ badge }: KBStoreViewerProps) {
  // Use existing BadgeKnowledgeBaseStoreContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeKnowledgeBaseStoreContent
        badgeId={badge.id}
        resultKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

