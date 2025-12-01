/**
 * SearchResultsViewer - Displays search results for index.search badges
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeSearchContent } from '../../../BadgeSearchContent'

interface SearchResultsViewerProps {
  badge: BadgeType
}

export function SearchResultsViewer({ badge }: SearchResultsViewerProps) {
  // Use existing BadgeSearchContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeSearchContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

