import { useCallback, useEffect, useRef } from 'react'
import { ActionIcon, Box, Group, Tabs, Text, Tooltip } from '@mantine/core'
import { IconPlus, IconX, IconArrowsMoveVertical, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { useAppStore } from '../store/app'
import TerminalView from './TerminalView'

export default function TerminalPanel({ context }: { context: 'agent' | 'explorer' }) {
  const open = useAppStore((s) => context === 'agent' ? s.agentTerminalPanelOpen : s.explorerTerminalPanelOpen)
  const height = useAppStore((s) => context === 'agent' ? s.agentTerminalPanelHeight : s.explorerTerminalPanelHeight)
  const setHeight = useAppStore((s) => context === 'agent' ? s.setAgentTerminalPanelHeight : s.setExplorerTerminalPanelHeight)
  const toggleExplorer = useAppStore((s) => s.toggleExplorerTerminalPanel)
  const setAgentOpen = useAppStore((s) => s.setAgentTerminalPanelOpen)

  // Local tabs state kept minimal: just IDs; each TerminalView owns its PTY lifecycle
  const tabsRef = useRef<string[]>(['t1'])
  const activeRef = useRef<string>('t1')
  const rerender = useRef(0)
  const force = useCallback(() => { rerender.current++; }, [])

  const addTab = () => {
    const id = `t${crypto.randomUUID().slice(0, 8)}`
    tabsRef.current.push(id)
    activeRef.current = id
    force()
  }
  const closeTab = (id: string) => {
    const idx = tabsRef.current.indexOf(id)
    if (idx >= 0) {
      tabsRef.current.splice(idx, 1)
      if (tabsRef.current.length === 0) {
        // Ensure there is always one terminal when panel is open
        if (open) {
          const nextId = `t${crypto.randomUUID().slice(0, 8)}`
          tabsRef.current.push(nextId)
          activeRef.current = nextId
        } else {
          activeRef.current = ''
        }
      } else if (activeRef.current === id) {
        activeRef.current = tabsRef.current[idx - 1] || tabsRef.current[0] || ''
      }
      force()
    }
  }

  const onMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY
      const next = Math.min(800, Math.max(160, startH + dy))
      setHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Ensure a terminal exists when panel is opened and none are present
  useEffect(() => {
    if (open && tabsRef.current.length === 0) addTab()
  }, [open])

  if (!open) {
    const onToggleClick = () => {
      if (context === 'explorer') toggleExplorer()
      else if (context === 'agent') setAgentOpen(true)
    }
    return (
      <Box style={{ height: 28, backgroundColor: '#252526', borderTop: '1px solid #3e3e42', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
        <Text size="sm" c="dimmed">Terminal</Text>
        <ActionIcon variant="subtle" onClick={onToggleClick}>
          <IconChevronUp size={16} />
        </ActionIcon>
      </Box>
    )
  }

  const onToggleClick = () => {
    if (context === 'explorer') toggleExplorer()
    else if (context === 'agent') setAgentOpen(false) // allow collapse in agent view
  }

  return (
    <Box style={{ height, backgroundColor: '#1e1e1e', borderTop: '1px solid #3e3e42', display: 'flex', flexDirection: 'column' }}>
      {/* Resize handle */}
      <div onMouseDown={onMouseDownResize} style={{ height: 6, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconArrowsMoveVertical size={12} color="#777" />
      </div>
      {/* Header */}
      <Group justify="space-between" px={8} py={6} style={{ borderBottom: '1px solid #3e3e42', background: '#252526' }}>
        <Text size="sm" c="dimmed">Terminal</Text>
        <Group gap={6} wrap="nowrap">
          <Tooltip label={open ? 'Collapse' : 'Expand'} withArrow position="left">
            <ActionIcon variant="subtle" onClick={onToggleClick}>
              {open ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="New Terminal" withArrow position="left">
            <ActionIcon variant="subtle" onClick={addTab}>
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Tabs */}
      <Tabs
        value={activeRef.current}
        onChange={(v) => { if (typeof v === 'string') { activeRef.current = v; force() }}}
        keepMounted={false}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <Tabs.List>
          {tabsRef.current.map((id) => (
            <Tabs.Tab key={id} value={id}
              rightSection={
                <ActionIcon component="div" size="xs" variant="subtle" onClick={(e) => { e.stopPropagation(); closeTab(id) }}>
                  <IconX size={12} />
                </ActionIcon>
              }
            >{id}</Tabs.Tab>
          ))}
        </Tabs.List>
        {tabsRef.current.map((id) => (
          <Tabs.Panel key={id} value={id} style={{ height: '100%', display: 'flex' }}>
            <TerminalView key={id} disableStdin={context === 'agent'} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Box>
  )
}

