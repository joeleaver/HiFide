/**
 * KBSearchViewer - Displays knowledge base search results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeKnowledgeBaseSearchContent } from '../../../BadgeKnowledgeBaseSearchContent'

interface KBSearchViewerProps {
  badge: BadgeType
}

export function KBSearchViewer({ badge }: KBSearchViewerProps) {
  return (
    <BadgeKnowledgeBaseSearchContent
      badgeId={badge.id}
      searchKey={badge.interactive?.data?.key}
      fullParams={badge.metadata?.fullParams ?? badge.args}
      llmResult={badge.result}
    />
  )
}

