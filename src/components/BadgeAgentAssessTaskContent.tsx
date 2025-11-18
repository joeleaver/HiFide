import { memo, useEffect, useState } from 'react'
import { Stack, Text, Group, Badge as MantineBadge, Divider } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeAgentAssessTaskContentProps {
  badgeId: string
  assessKey: string
}

export const BadgeAgentAssessTaskContent = memo(function BadgeAgentAssessTaskContent({
  badgeId,
  assessKey
}: BadgeAgentAssessTaskContentProps) {
  void badgeId

  const [data, setData] = useState<any>(null)

  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: assessKey }).then((res: any) => {
      const val = res && typeof res === 'object' && 'data' in res ? (res as any).data : res
      setData(val)
    }).catch(() => {})
  }, [assessKey])

  if (!data) {
    return <Text size="xs" c="dimmed">No assessment data</Text>
  }

  const assessment = data.assessment || {}
  const guidance = data.guidance

  return (
    <Stack gap={12} style={{ padding: 8 }}>
      {/* Task Assessment */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>Task Assessment</Text>
        <Stack gap={4}>
          {assessment.task_type && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Task Type:</Text>
              <MantineBadge size="xs" variant="light" color="blue">{assessment.task_type}</MantineBadge>
            </Group>
          )}
          {typeof assessment.estimated_files === 'number' && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Estimated Files:</Text>
              <Text size="xs" c="gray.3">{assessment.estimated_files}</Text>
            </Group>
          )}
          {typeof assessment.estimated_iterations === 'number' && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Estimated Iterations:</Text>
              <Text size="xs" c="gray.3">{assessment.estimated_iterations}</Text>
            </Group>
          )}
          {assessment.strategy && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Strategy:</Text>
              <Text size="xs" c="gray.3">{assessment.strategy}</Text>
            </Group>
          )}
        </Stack>
      </div>

      <Divider color="#3d3d3d" />

      {/* Resource Budget */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>Resource Budget</Text>
        <Stack gap={4}>
          {typeof assessment.token_budget === 'number' && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Token Budget:</Text>
              <MantineBadge size="xs" variant="light" color="green">{assessment.token_budget.toLocaleString()}</MantineBadge>
            </Group>
          )}
          {typeof assessment.max_iterations === 'number' && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={500}>Max Iterations:</Text>
              <MantineBadge size="xs" variant="light" color="orange">{assessment.max_iterations}</MantineBadge>
            </Group>
          )}
        </Stack>
      </div>

      {guidance && (
        <>
          <Divider color="#3d3d3d" />
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={4}>Guidance</Text>
            <Text size="xs" c="gray.3">{guidance}</Text>
          </div>
        </>
      )}
    </Stack>
  )
})

