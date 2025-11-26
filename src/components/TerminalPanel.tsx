import { Group, Text, UnstyledButton, Badge } from '@mantine/core'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTerminalStore } from '../store/terminal'
import { useTerminalTabs } from '../store/terminalTabs'
import { usePanelResize } from '../hooks/usePanelResize'
import TerminalView from './TerminalView'
import { getBackendClient } from '../lib/backend/bootstrap'

export default function TerminalPanel({ context }: { context: 'agent' | 'explorer' }) {
  // Get tabs from store (not local state!)
  const tabs = useTerminalTabs((s) => context === 'agent' ? s.agentTabs : s.explorerTabs)
  const activeTab = useTerminalTabs((s) => context === 'agent' ? s.agentActive : s.explorerActive)
  const hydrateTabs = useTerminalTabs((s) => s.hydrateTabs)

  const [panelHeight, setPanelHeight] = useState<number>(300)

  // Use renderer-local terminal store for xterm operations and UI state
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const open = useTerminalStore((s) => context === 'agent' ? s.agentTerminalPanelOpen : s.explorerTerminalPanelOpen)
  const setTerminalPanelOpen = useTerminalStore((s) => s.setTerminalPanelOpen)

  // Hydrate tabs and height on mount
  useEffect(() => {
    hydrateTabs()
    ;(async () => {
      try {
        const w: any = await getBackendClient()?.rpc('ui.getWindowState', {})
        const ws = w?.windowState || {}
        setPanelHeight(
          context === 'agent'
            ? (typeof ws.agentTerminalPanelHeight === 'number' ? ws.agentTerminalPanelHeight : 300)
            : (typeof ws.explorerTerminalPanelHeight === 'number' ? ws.explorerTerminalPanelHeight : 300)
        )
      } catch {}
    })()
  }, [hydrateTabs, context])

  const addTab = async () => {
    try { await getBackendClient()?.rpc('terminal.addTab', { context }) } catch {}
  }

  const closeTab = async (id: string) => {
    if (context === 'agent') {
      try { await getBackendClient()?.rpc('terminal.restartAgent', { tabId: id }) } catch {}
    } else {
      try { await getBackendClient()?.rpc('terminal.removeTab', { context, tabId: id }) } catch {}
    }
  }

  const onToggleClick = () => {
    setTerminalPanelOpen(context, !open)
  }

  const { onMouseDown, isResizingRef } = usePanelResize({
    initialHeight: panelHeight,
    setHeight: (newHeight) => {
      setPanelHeight(newHeight)
      void getBackendClient()?.rpc('ui.updateWindowState', {
        updates: {
          [context === 'agent' ? 'agentTerminalPanelHeight' : 'explorerTerminalPanelHeight']: newHeight
        }
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
        height: open ? `${panelHeight}px` : 'auto',
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
            {context === 'agent' ? 'AGENT TERMINAL' : 'TERMINAL'}
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
              paddingLeft: '12px',
            }}
          >
            {tabs.map((id) => (
              <div
                key={id}
                onClick={async () => {
                  try { await getBackendClient()?.rpc('terminal.setActive', { context, tabId: id }) } catch {}
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

