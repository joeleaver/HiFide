/**
 * KBSearchViewer - Displays knowledge base search results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeKnowledgeBaseSearchContent } from '../../../BadgeKnowledgeBaseSearchContent'

interface KBSearchViewerProps {
  badge: BadgeType
}

export function KBSearchViewer({ badge }: KBSearchViewerProps) {
  // Use existing BadgeKnowledgeBaseSearchContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeKnowledgeBaseSearchContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

