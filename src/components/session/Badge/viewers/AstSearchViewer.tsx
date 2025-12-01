/**
 * AstSearchViewer - Displays AST search results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeAstSearchContent } from '../../../BadgeAstSearchContent'

interface AstSearchViewerProps {
  badge: BadgeType
}

export function AstSearchViewer({ badge }: AstSearchViewerProps) {
  // Use existing BadgeAstSearchContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeAstSearchContent
        badgeId={badge.id}
        searchKey={badge.interactive.data.key}
        fullParams={badge.metadata?.fullParams}
      />
    )
  }

  return null
}

