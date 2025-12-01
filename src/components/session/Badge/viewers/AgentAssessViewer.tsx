/**
 * AgentAssessViewer - Displays agent assessment results
 */

import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeAgentAssessTaskContent } from '../../../BadgeAgentAssessTaskContent'

interface AgentAssessViewerProps {
  badge: BadgeType
}

export function AgentAssessViewer({ badge }: AgentAssessViewerProps) {
  // Use existing BadgeAgentAssessTaskContent component
  if (badge.interactive?.data?.key) {
    return (
      <BadgeAgentAssessTaskContent
        badgeId={badge.id}
        assessKey={badge.interactive.data.key}
      />
    )
  }

  return null
}

