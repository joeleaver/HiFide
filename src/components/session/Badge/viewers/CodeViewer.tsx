/**
 * CodeViewer - Displays code snippets for fs.read_lines badges
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeReadLinesContent } from '../../../BadgeReadLinesContent'

interface CodeViewerProps {
  badge: BadgeType
}

export function CodeViewer({ badge }: CodeViewerProps) {
  // Use existing BadgeReadLinesContent component
  if (badge.interactive?.data?.key) {
    return <BadgeReadLinesContent badgeId={badge.id} readKey={badge.interactive.data.key} />
  }

  return null
}

