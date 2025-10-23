import { Stack, UnstyledButton, Tooltip } from '@mantine/core'
import { IconMessageCircle, IconFolder, IconGitBranch, IconSettings } from '@tabler/icons-react'
import { useAppStore, useDispatch, selectCurrentView, type ViewType } from '../store'
import { useRerenderTrace } from '../utils/perf'

const ACTIVITY_BAR_WIDTH = 48

interface ActivityButtonProps {
  icon: React.ReactNode
  label: string
  view: ViewType
  active: boolean
  onClick: () => void
}

function ActivityButton({ icon, label, view: _view, active, onClick }: ActivityButtonProps) {
  return (
    <Tooltip label={label} position="right" withArrow>
      <UnstyledButton
        onClick={onClick}
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
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.color = '#ffffff'
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.color = '#858585'
          }
        }}
      >
        {icon}
      </UnstyledButton>
    </Tooltip>
  )
}

export default function ActivityBar() {
  const currentView = useAppStore(selectCurrentView)
  useRerenderTrace('ActivityBar', { currentView })
  const dispatch = useDispatch()

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
      <ActivityButton
        icon={<IconMessageCircle size={24} stroke={1.5} />}
        label="Agent"
        view="agent"
        active={currentView === 'agent'}
        onClick={() => dispatch('setCurrentView', 'agent')}
      />
      <ActivityButton
        icon={<IconFolder size={24} stroke={1.5} />}
        label="Explorer"
        view="explorer"
        active={currentView === 'explorer'}
        onClick={() => dispatch('setCurrentView', 'explorer')}
      />
      <ActivityButton
        icon={<IconGitBranch size={24} stroke={1.5} />}
        label="Source Control"
        view="sourceControl"
        active={currentView === 'sourceControl'}
        onClick={() => dispatch('setCurrentView', 'sourceControl')}
      />

      {/* Spacer to push settings to bottom */}
      <div style={{ flex: 1 }} />

      <ActivityButton
        icon={<IconSettings size={24} stroke={1.5} />}
        label="Settings"
        view="settings"
        active={currentView === 'settings'}
        onClick={() => dispatch('setCurrentView', 'settings')}
      />
    </Stack>
  )
}

