import { Stack, Text, Group } from '@mantine/core'
import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { JsonViewer } from './JsonViewer'
import { BadgePill } from '../components/BadgePill'

export function OperationResultViewer({ badge }: { badge: BadgeType }) {
  const payload = badge.metadata?.fullParams

  const hasDiagnostics = Boolean(payload?.diagnostics)
  const hasEffects = Boolean(payload?.effects)

  return (
    <Stack gap={8} p={8}>
      <Group gap={6} wrap="wrap">
        {hasDiagnostics && typeof payload?.diagnostics?.durationMs === 'number' && (
          <BadgePill>{payload.diagnostics.durationMs}ms</BadgePill>
        )}
        {hasDiagnostics && typeof payload?.diagnostics?.exitCode === 'number' && (
          <BadgePill>exit {payload.diagnostics.exitCode}</BadgePill>
        )}
        {hasDiagnostics && payload?.diagnostics?.timedOut && (
          <BadgePill>timed out</BadgePill>
        )}
        {hasEffects && Array.isArray(payload?.effects?.files) && (
          <BadgePill>{payload.effects.files.length} file effect(s)</BadgePill>
        )}
      </Group>

      <Text size="xs" c="dimmed">
        Standard tool payload (inputs/effects/outputs/diagnostics)
      </Text>

      {/* For now: render as JSON. This viewer exists so we can iterate on a richer UI
          while keeping a consistent contentType and expansion contract. */}
      <JsonViewer badge={badge} />
    </Stack>
  )
}
