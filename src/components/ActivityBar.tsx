import { Stack, UnstyledButton, Tooltip } from '@mantine/core'
import {
  IconTopologyStar,
  IconFolder,
  IconGitBranch,
  IconSettings,
  IconBook,
  IconLayoutKanban,
  IconChevronLeft,
} from '@tabler/icons-react'
import { useRerenderTrace } from '../utils/perf'
import type { ReactNode, MouseEvent } from 'react'
import { useUiStore } from '../store/ui'
import { getBackendClient } from '../lib/backend/bootstrap'

type ViewType = 'flow' | 'explorer' | 'sourceControl' | 'knowledgeBase' | 'kanban' | 'settings'

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
  const currentView = useUiStore((s) => s.currentView)
  const setCurrentViewLocal = useUiStore((s) => (s as any).setCurrentViewLocal)

  useRerenderTrace('ActivityBar', { currentView })
  const mainCollapsed = useUiStore((s) => (s as any).mainCollapsed)
  const setMainCollapsed = useUiStore((s) => (s as any).setMainCollapsed)

  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)


  const buttons: ActivityButtonProps[] = [
    {
      icon: <IconTopologyStar size={24} stroke={1.5} />,
      label: 'Flow',
      view: 'flow',
      active: !mainCollapsed && currentView === 'flow',
      onClick: async () => {
        setCurrentViewLocal('flow')
        if (mainCollapsed) {
          try {
            const client = getBackendClient()
            const res: any = await client?.rpc('workspace.getSettings', {})
            const prev = (res && res.settings) || {}
            const prevLayout = prev.layout || {}
            const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
            const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

            // Exit collapsed first and restore prior panel width locally
            setMainCollapsed(false)
            try { setSessionPanelWidth(persistedSessionWidth) } catch {}

            // Persist only collapse state (do not overwrite sessionPanelWidth here)
            await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })

            // Allow effect cleanup to remove collapsed auto-resize handler before resizing window
            await new Promise((r) => setTimeout(r, 0))

            const currentContentWidth = Math.max(0, window.innerWidth || 0)
            const currentContentHeight = Math.max(0, window.innerHeight || 0)
            const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
            await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
          } catch {}
        }
      },
    },
    {
      icon: <IconFolder size={24} stroke={1.5} />,
      label: 'Explorer',
      view: 'explorer',
      active: !mainCollapsed && currentView === 'explorer',
      onClick: async () => {
        setCurrentViewLocal('explorer')
        if (mainCollapsed) {
          try {
            const client = getBackendClient()
            const res: any = await client?.rpc('workspace.getSettings', {})
            const prev = (res && res.settings) || {}
            const prevLayout = prev.layout || {}
            const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
            const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

            setMainCollapsed(false)
            try { setSessionPanelWidth(persistedSessionWidth) } catch {}
            await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })
            await new Promise((r) => setTimeout(r, 0))

            const currentContentWidth = Math.max(0, window.innerWidth || 0)
            const currentContentHeight = Math.max(0, window.innerHeight || 0)
            const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
            await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
          } catch {}
        }
      },
    },
    {
      icon: <IconLayoutKanban size={24} stroke={1.5} />,
      label: 'Kanban',
      view: 'kanban',
      active: !mainCollapsed && currentView === 'kanban',
      onClick: async () => {
        setCurrentViewLocal('kanban')
        if (mainCollapsed) {
          try {
            const client = getBackendClient()
            const res: any = await client?.rpc('workspace.getSettings', {})
            const prev = (res && res.settings) || {}
            const prevLayout = prev.layout || {}
            const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
            const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

            setMainCollapsed(false)
            try { setSessionPanelWidth(persistedSessionWidth) } catch {}
            await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })
            await new Promise((r) => setTimeout(r, 0))

            const currentContentWidth = Math.max(0, window.innerWidth || 0)
            const currentContentHeight = Math.max(0, window.innerHeight || 0)
            const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
            await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
          } catch {}
        }
      },
    },
    {
      icon: <IconGitBranch size={24} stroke={1.5} />,
      label: 'Source Control',
      view: 'sourceControl',
      active: !mainCollapsed && currentView === 'sourceControl',
      onClick: async () => {
        setCurrentViewLocal('sourceControl')
        if (mainCollapsed) {
          try {
            const client = getBackendClient()
            const res: any = await client?.rpc('workspace.getSettings', {})
            const prev = (res && res.settings) || {}
            const prevLayout = prev.layout || {}
            const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
            const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

            setMainCollapsed(false)
            try { setSessionPanelWidth(persistedSessionWidth) } catch {}
            await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })
            await new Promise((r) => setTimeout(r, 0))

            const currentContentWidth = Math.max(0, window.innerWidth || 0)
            const currentContentHeight = Math.max(0, window.innerHeight || 0)
            const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
            await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
          } catch {}
        }
      },
    },
    {
      icon: <IconBook size={24} stroke={1.5} />,
      label: 'Knowledge Base',
      view: 'knowledgeBase',
      active: !mainCollapsed && currentView === 'knowledgeBase',
      onClick: async () => {
        setCurrentViewLocal('knowledgeBase')
        if (mainCollapsed) {
          try {
            const client = getBackendClient()
            const res: any = await client?.rpc('workspace.getSettings', {})
            const prev = (res && res.settings) || {}
            const prevLayout = prev.layout || {}
            const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
            const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

            setMainCollapsed(false)
            try { setSessionPanelWidth(persistedSessionWidth) } catch {}
            await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })
            await new Promise((r) => setTimeout(r, 0))

            const currentContentWidth = Math.max(0, window.innerWidth || 0)
            const currentContentHeight = Math.max(0, window.innerHeight || 0)
            const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
            await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
          } catch {}
        }
      },
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
      }}>
      {!mainCollapsed && (
        <Tooltip label={'Collapse Main'} position="right" withArrow>
          <UnstyledButton
            onClick={async () => {
              const next = true // collapsing only
              setMainCollapsed(next)

              const uiState: any = (useUiStore as any).getState?.() || {}
              const sessionWidth: number = Number(uiState.sessionPanelWidth) || 300
              const currentContentWidth = Math.max(0, window.innerWidth || 0)
              const currentContentHeight = Math.max(0, window.innerHeight || 0)

              try {
                const client = getBackendClient()
                const res: any = await client?.rpc('workspace.getSettings', {})
                const prev = (res && res.settings) || {}
                const prevLayout = prev.layout || {}

                const layout: any = {
                  ...prevLayout,
                  mainCollapsed: true,
                  sessionPanelWidth: sessionWidth,
                  expandedWindowWidth: currentContentWidth, // remember expanded width
                }
                await client?.rpc('workspace.setSetting', { key: 'layout', value: layout })

                try {
                  const client = getBackendClient()
                  if (client) {
                    const targetWidth = Math.max(300, Math.floor(sessionWidth + ACTIVITY_BAR_WIDTH))
                    await client.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
                  }
                } catch {}
              } catch {}
            }}
            style={{
              width: ACTIVITY_BAR_WIDTH,
              height: ACTIVITY_BAR_WIDTH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#cccccc',
              backgroundColor: 'transparent',
              borderLeft: '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            <IconChevronLeft size={20} stroke={1.5} />
          </UnstyledButton>
        </Tooltip>
      )}

      {buttons.map((props) => (
        <ActivityButton key={props.label} {...props} />
      ))}

      <div style={{ flex: 1 }} />

      <ActivityButton
        icon={<IconSettings size={24} stroke={1.5} />}
        label="Settings"
        view="settings"
        active={!mainCollapsed && currentView === 'settings'}
        onClick={async () => {
          setCurrentViewLocal('settings')
          if (mainCollapsed) {
            try {
              const client = getBackendClient()
              const res: any = await client?.rpc('workspace.getSettings', {})
              const prev = (res && res.settings) || {}
              const prevLayout = prev.layout || {}
              const prevExpandedWidth: number = Number(prevLayout.expandedWindowWidth) || 0
              const persistedSessionWidth: number = Math.max(240, Math.floor(Number(prevLayout.sessionPanelWidth) || 300))

              setMainCollapsed(false)
              try { setSessionPanelWidth(persistedSessionWidth) } catch {}
              await client?.rpc('workspace.setSetting', { key: 'layout', value: { ...prevLayout, mainCollapsed: false } })
              await new Promise((r) => setTimeout(r, 0))

              const currentContentWidth = Math.max(0, window.innerWidth || 0)
              const currentContentHeight = Math.max(0, window.innerHeight || 0)
              const targetWidth = Math.max(800, Math.floor(prevExpandedWidth || currentContentWidth))
              await getBackendClient()?.rpc('window.setContentSize', { width: targetWidth, height: currentContentHeight })
            } catch {}
          }
        }}
      />
    </Stack>
  )
}
