import { Group, Text, UnstyledButton, Badge } from '@mantine/core'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { useEffect } from 'react'
import { useAppStore, useDispatch, selectAgentTerminalTabs, selectAgentActiveTerminal, selectExplorerTerminalTabs, selectExplorerActiveTerminal } from '../store'
import { useTerminalStore } from '../store/terminal'
import { usePanelResize } from '../hooks/usePanelResize'
import TerminalView from './TerminalView'

export default function TerminalPanel({ context }: { context: 'agent' | 'explorer' }) {
  // Use selectors for better performance
  const tabs = useAppStore(context === 'agent' ? selectAgentTerminalTabs : selectExplorerTerminalTabs)
  const activeTab = useAppStore(context === 'agent' ? selectAgentActiveTerminal : selectExplorerActiveTerminal)

  // Read from windowState (main store)
  const height = useAppStore((s) => context === 'agent' ? s.windowState.agentTerminalPanelHeight : s.windowState.explorerTerminalPanelHeight)

  // Use dispatch for main store actions (tab management)
  const dispatch = useDispatch()

  // Use renderer-local terminal store for xterm operations and UI state
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const open = useTerminalStore((s) => context === 'agent' ? s.agentTerminalPanelOpen : s.explorerTerminalPanelOpen)
  const setTerminalPanelOpen = useTerminalStore((s) => s.setTerminalPanelOpen)

  const addTab = () => {
    dispatch('addTerminalTab', context)
  }

  const closeTab = (id: string) => {
    if (context === 'agent') {
      // For agent terminals, dispatch to main store to restart PTY
      dispatch('restartAgentTerminal', { tabId: id })
    } else {
      // For explorer terminals, just remove the tab
      dispatch('removeTerminalTab', { context, tabId: id })
    }
  }

  const onToggleClick = () => {
    setTerminalPanelOpen(context, !open)
  }

  const { onMouseDown, isResizingRef } = usePanelResize({
    initialHeight: height,
    setHeight: (newHeight) => {
      dispatch('updateWindowState', {
        [context === 'agent' ? 'agentTerminalPanelHeight' : 'explorerTerminalPanelHeight']: newHeight
      })
    },
    min: 160,
    max: 800,
    handlePosition: 'top',
    onEnd: () => {
      // Fit all terminals after resize
      tabs.forEach((tabId) => fitTerminal(tabId))
    },
  })

  // Ensure the newly activated tab fits once visible, and when panel opens
  useEffect(() => {
    if (!open) return
    if (!activeTab) return
    // Delay to next frame so display:none -> block has taken effect
    const id = requestAnimationFrame(() => fitTerminal(activeTab))
    return () => cancelAnimationFrame(id)
  }, [activeTab, open, fitTerminal])

  return (
    <div
      style={{
        height: open ? `${height}px` : 'auto',
        backgroundColor: '#1e1e1e',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Resize handle at top - shown when open */}
      {open && (
        <div
          onMouseDown={onMouseDown}
          style={{
            height: '4px',
            cursor: 'ns-resize',
            backgroundColor: 'transparent',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#007acc'
          }}
          onMouseLeave={(e) => {
            if (!isResizingRef.current) {
              e.currentTarget.style.backgroundColor = 'transparent'
            }
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          height: '28px',
          padding: '0 12px',
          borderBottom: open ? '1px solid #3e3e42' : 'none',
          backgroundColor: '#252526',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">
            TERMINAL
          </Text>
          {tabs.length > 1 && (
            <Badge size="xs" variant="light" color="gray">
              {tabs.length}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          {open && context === 'explorer' && (
            <UnstyledButton
              onClick={addTab}
              style={{
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#888'
              }}
            >
              <IconPlus size={14} />
            </UnstyledButton>
          )}
          {/* Collapse button */}
          <UnstyledButton
            onClick={onToggleClick}
            style={{
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#888'
            }}
          >
            {open ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </UnstyledButton>
        </Group>
      </div>

      {/* Terminal content area */}
      {open && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Tab buttons */}
          <div
            style={{
              height: '36px',
              display: 'flex',
              alignItems: 'flex-end',
              backgroundColor: '#252526',
              borderBottom: '1px solid #3e3e42',
              flexShrink: 0,
            }}
          >
            {tabs.map((id) => (
              <div
                key={id}
                onClick={() => {
                  dispatch('setActiveTerminal', { context, tabId: id })
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  backgroundColor: activeTab === id ? '#1e1e1e' : 'transparent',
                  borderTop: activeTab === id ? '1px solid #007acc' : '1px solid transparent',
                  borderLeft: '1px solid #3e3e42',
                  borderRight: '1px solid #3e3e42',
                  color: activeTab === id ? '#ffffff' : '#888888',
                  fontSize: '13px',
                }}
              >
                <span>{id}</span>
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(id)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                    color: '#888',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#fff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#888'
                  }}
                >
                  <IconX size={12} />
                </div>
              </div>
            ))}
          </div>

          {/* Terminal views */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {tabs.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                <Text size="sm">{context === 'explorer' ? 'No terminals open. Click + to create one.' : 'No terminals open.'}</Text>
              </div>
            ) : (
              tabs.map((id) => (
                <div
                  key={id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: activeTab === id ? 'block' : 'none',
                  }}
                >
                  <TerminalView tabId={id} context={context} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

