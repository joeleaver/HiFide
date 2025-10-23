/**
 * FlowStatusIndicator Component
 *
 * Displays the current flow execution status with appropriate icon and color,
 * and shows contextual controls (Stop/Restart) within the status box.
 */

import { Group, Text, Loader, ActionIcon } from '@mantine/core'
import { IconClock, IconPlayerStop, IconPlayerPlay } from '@tabler/icons-react'
import { useDispatch } from '../store'

type FlowStatus = 'stopped' | 'running' | 'waitingForInput'

interface FlowStatusIndicatorProps {
  status: FlowStatus
}

export function FlowStatusIndicator({ status }: FlowStatusIndicatorProps) {
  const dispatch = useDispatch()

  if (status === 'stopped') {
    return (
      <div style={{ padding: '8px 0' }}>
        <Group gap="sm" align="center" justify="space-between">
          <Group gap="sm" align="center">
            <IconClock size={18} color="#9aa0a6" />
            <Text size="sm" c="#9aa0a6" fw={500}>
              Flow stopped
            </Text>
          </Group>
          <ActionIcon
            size="sm"
            variant="filled"
            color="blue"
            title="Start flow"
            onClick={() => dispatch('flowInit')}
          >
            <IconPlayerPlay size={14} />
          </ActionIcon>
        </Group>
      </div>
    )
  }

  const config: Record<Exclude<FlowStatus, 'stopped'>, { icon: JSX.Element; text: string; color: string }> = {
    running: {
      icon: <Loader size={18} color="#4dabf7" />,
      text: 'Flow running... ',
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
      <Group gap="sm" align="center" justify="space-between">
        <Group gap="sm" align="center">
          {icon}
          <Text size="sm" c={color} fw={500}>
            {text}
          </Text>
        </Group>
        <ActionIcon
          size="sm"
          variant="filled"
          color="red"
          title="Stop flow"
          onClick={() => dispatch('feStop')}
        >
          <IconPlayerStop size={14} />
        </ActionIcon>
      </Group>
    </div>
  )
}

