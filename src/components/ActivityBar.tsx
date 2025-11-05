import { Stack, UnstyledButton, Tooltip } from '@mantine/core'
import {
  IconMessageCircle,
  IconFolder,
  IconGitBranch,
  IconSettings,
  IconBook,
  IconLayoutKanban,
} from '@tabler/icons-react'
import { useAppStore, useDispatch, selectCurrentView, type ViewType } from '../store'
import { useRerenderTrace } from '../utils/perf'
import type { ReactNode, MouseEvent } from 'react'

const ACTIVITY_BAR_WIDTH = 48

interface ActivityButtonProps {
  icon: ReactNode
  label: string
  view: ViewType
  active: boolean
  onClick: () => void
}

function ActivityButton({ icon, label, active, onClick }: ActivityButtonProps) {
  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    if (!active) {
      event.currentTarget.style.color = '#ffffff'
    }
  }

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    if (!active) {
      event.currentTarget.style.color = '#858585'
    }
  }

  return (
    <Tooltip label={label} position="right" withArrow>
      <UnstyledButton
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          width: ACTIVITY_BAR_WIDTH,
          height: ACTIVITY_BAR_WIDTH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: active ? '#ffffff' : '#858585',
          backgroundColor: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
          borderLeft: active ? '2px solid #007acc' : '2px solid transparent',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        }}
      >
        {icon}
      </UnstyledButton>
    </Tooltip>
  )
}

export default function ActivityBar() {
  const currentView = useAppStore(selectCurrentView)
  const dispatch = useDispatch()

  useRerenderTrace('ActivityBar', { currentView })

  const buttons: ActivityButtonProps[] = [
    {
      icon: <IconMessageCircle size={24} stroke={1.5} />,
      label: 'Agent',
      view: 'agent',
      active: currentView === 'agent',
      onClick: () => dispatch('setCurrentView', { view: 'agent' }),
    },
    {
      icon: <IconFolder size={24} stroke={1.5} />,
      label: 'Explorer',
      view: 'explorer',
      active: currentView === 'explorer',
      onClick: () => dispatch('setCurrentView', { view: 'explorer' }),
    },
    {
      icon: <IconLayoutKanban size={24} stroke={1.5} />,
      label: 'Kanban',
      view: 'kanban',
      active: currentView === 'kanban',
      onClick: () => dispatch('setCurrentView', { view: 'kanban' }),
    },
    {
      icon: <IconGitBranch size={24} stroke={1.5} />,
      label: 'Source Control',
      view: 'sourceControl',
      active: currentView === 'sourceControl',
      onClick: () => dispatch('setCurrentView', { view: 'sourceControl' }),
    },
    {
      icon: <IconBook size={24} stroke={1.5} />,
      label: 'Knowledge Base',
      view: 'knowledgeBase',
      active: currentView === 'knowledgeBase',
      onClick: () => dispatch('setCurrentView', { view: 'knowledgeBase' }),
    },
  ]

  return (
    <Stack
      gap={0}
      style={{
        width: ACTIVITY_BAR_WIDTH,
        height: '100%',
        backgroundColor: '#333333',
        borderRight: '1px solid #1e1e1e',
        flexShrink: 0,
      }}
    >
      {buttons.map((props) => (
        <ActivityButton key={props.label} {...props} />
      ))}

      <div style={{ flex: 1 }} />

      <ActivityButton
        icon={<IconSettings size={24} stroke={1.5} />}
        label="Settings"
        view="settings"
        active={currentView === 'settings'}
        onClick={() => dispatch('setCurrentView', { view: 'settings' })}
      />
    </Stack>
  )
}
