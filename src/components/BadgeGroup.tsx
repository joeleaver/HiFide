/**
 * BadgeGroup Component
 *
 * Renders a group of badges from a SessionBadgeGroup item.
 * Badges are displayed inline with the conversation timeline.
 */

import { Badge as MantineBadge, Group, Text, Stack } from '@mantine/core'
import type { SessionBadgeGroup } from '../store'
import { NodeOutputBox } from './NodeOutputBox'

interface BadgeGroupProps {
  badgeGroup: SessionBadgeGroup
}

export function BadgeGroup({ badgeGroup }: BadgeGroupProps) {
  const { nodeLabel, nodeKind, badges, provider, model, cost } = badgeGroup

  if (badges.length === 0) return null

  return (
    <NodeOutputBox
      nodeLabel={nodeLabel}
      nodeType={nodeKind}
      provider={provider}
      model={model}
      cost={cost}
    >
      <Stack gap="xs">
        <Group gap="xs" wrap="wrap">
          {badges.map((badge: any) => (
            <MantineBadge
              key={badge.id}
              color={badge.color || 'gray'}
              variant={badge.variant || 'light'}
              size="sm"
              leftSection={badge.icon}
              tt="none"
              style={{
                opacity: badge.status === 'running' ? 0.7 : 1,
              }}
            >
              {badge.label}
              {badge.status === 'running' && ' ...'}
              {badge.status === 'error' && ' ✗'}
            </MantineBadge>
          ))}
        </Group>

        {/* Show errors if any */}
        {badges.some((b: any) => b.error) && (
          <Stack gap={4}>
            {badges
              .filter((b: any) => b.error)
              .map((badge: any) => (
                <Text key={badge.id} size="xs" c="red.4">
                  {badge.label}: {badge.error}
                </Text>
              ))}
          </Stack>
        )}
      </Stack>
    </NodeOutputBox>
  )
}

