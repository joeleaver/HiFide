/**
 * FlowStatusIndicator Component
 *
 * Displays the current flow execution status with appropriate icon and color.
 * Handles all flow states: running, waiting for input, stopped.
 */

import { Group, Text, Loader } from '@mantine/core'
import { IconClock } from '@tabler/icons-react'

type FlowStatus = 'stopped' | 'running' | 'waitingForInput'

interface FlowStatusIndicatorProps {
  status: FlowStatus
}

export function FlowStatusIndicator({ status }: FlowStatusIndicatorProps) {
  if (status === 'stopped') return null

  const config: Record<Exclude<FlowStatus, 'stopped'>, { icon: JSX.Element; text: string; color: string }> = {
    running: {
      icon: <Loader size={18} color="#4dabf7" />,
      text: 'Flow running...',
      color: '#4dabf7',
    },
    waitingForInput: {
      icon: <IconClock size={18} color="#4ade80" />,
      text: 'Waiting for user input',
      color: '#4ade80',
    },
  }

  const { icon, text, color } = config[status]

  return (
    <div style={{ padding: '8px 0' }}>
      <Group gap="sm" align="center">
        {icon}
        <Text size="sm" c={color} fw={500}>
          {text}
        </Text>
      </Group>
    </div>
  )
}

