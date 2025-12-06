/**
 * FlowStatusIndicator Component
 *
 * Displays the current flow execution status with appropriate icon and color,
 * and shows contextual controls (Stop/Restart) within the status box.
 */

import React, { ReactNode } from 'react'
import { Group, Text, Loader, ActionIcon, Badge } from '@mantine/core'
import { IconClock, IconPlayerStop, IconPlayerPlay } from '@tabler/icons-react'
import { useFlowRuntime } from '../store/flowRuntime'
import { FlowService } from '@/services/flow'
import { useSessionUi } from '../store/sessionUi'

interface StatusConfig {
  icon: React.ReactNode
  text: string
  color: string
}

export function FlowStatusIndicator() {
  const runtime = useFlowRuntime()
  const currentId = useSessionUi(s => s.currentId)
  const { status, nodeState, requestId } = runtime

  // Compute executing node badge for running status
  let badgeEl: ReactNode = null
  if (status === 'running') {
    // Find first executing or streaming node
    const executingEntry = Object.entries(nodeState).find(([, state]) =>
      state.status === 'executing' || state.status === 'streaming'
    )
    if (executingEntry) {
      const [nodeId, state] = executingEntry
      const nodeType = nodeId.split('-')[0]
      const nodeLabel = nodeType.charAt(0).toUpperCase() + nodeType.slice(1)

      // Parse border color from style (e.g., "2px solid #4dabf7" -> "#4dabf7")
      const style = state.style
      let badgeColor = '#64748b' // fallback gray
      if (style?.border) {
        const match = style.border.match(/#[\\da-fA-F]{6}/)
        if (match) badgeColor = match[0]
      }

      badgeEl = (
        <Badge size="xs" variant="light" color={badgeColor}>
          {nodeLabel}
        </Badge>
      )
    }
  }

  const getConfig = (): StatusConfig => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader size={18} color="#4dabf7" />,
          text: 'Flow running',
          color: '#4dabf7',
        }
      case 'waitingForInput':
        return {
          icon: <IconClock size={18} color="#4ade80" />,
          text: 'Waiting for user input',
          color: '#4ade80',
        }
      default:
        return { icon: null, text: '', color: '' }
    }
  }

  if (status === 'stopped') {
    return (
      <Group style={{ padding: '8px 0' }} gap="sm" align="center" justify="space-between">
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
          onClick={async () => { await FlowService.start({ sessionId: currentId || undefined }).catch((e) => console.error(e)) }}
        >
          <IconPlayerPlay size={14} />
        </ActionIcon>
      </Group>
    )
  }

  const { icon, text, color } = getConfig()

  return (
    <Group style={{ padding: '8px 0' }} gap="sm" align="center" justify="space-between">
      <Group gap="sm" align="center">
        {icon}
        <Text size="sm" c={color} fw={500}>{text}</Text>
        {badgeEl}
      </Group>
      <ActionIcon
        size="sm"
        variant="filled"
        color="red"
        title="Stop flow"
        onClick={async () => {
          if (requestId) {
            await FlowService.stop(requestId).catch((e) => console.error(e))
          }
        }}
      >
        <IconPlayerStop size={14} />
      </ActionIcon>
    </Group>
  )
}

export default FlowStatusIndicator;

