import { Group, Text, UnstyledButton, Badge } from '@mantine/core'
import { IconPlus, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react'
import { useAppStore } from '../store/app'
import { usePanelResize } from '../hooks/usePanelResize'
import TerminalView from './TerminalView'

export default function TerminalPanel({ context }: { context: 'agent' | 'explorer' }) {
  const open = useAppStore((s) => context === 'agent' ? s.agentTerminalPanelOpen : s.explorerTerminalPanelOpen)
  const height = useAppStore((s) => context === 'agent' ? s.agentTerminalPanelHeight : s.explorerTerminalPanelHeight)
  const setHeight = useAppStore((s) => context === 'agent' ? s.setAgentTerminalPanelHeight : s.setExplorerTerminalPanelHeight)
  const toggleExplorer = useAppStore((s) => s.toggleExplorerTerminalPanel)
  const setAgentOpen = useAppStore((s) => s.setAgentTerminalPanelOpen)

  // Terminal tabs from store
  const tabs = useAppStore((s) => context === 'agent' ? s.agentTerminalTabs : s.explorerTerminalTabs)
  const activeTab = useAppStore((s) => context === 'agent' ? s.agentActiveTerminal : s.explorerActiveTerminal)
  const addTerminalTab = useAppStore((s) => s.addTerminalTab)
  const removeTerminalTab = useAppStore((s) => s.removeTerminalTab)
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal)
  const fitAllTerminals = useAppStore((s) => s.fitAllTerminals)

  const addTab = () => {
    addTerminalTab(context)
  }

  const closeTab = (id: string) => {
    removeTerminalTab(context, id)
  }


  const onToggleClick = () => {
    if (context === 'explorer') toggleExplorer()
    else if (context === 'agent') setAgentOpen(!open)
  }

  const { onMouseDown, isResizingRef } = usePanelResize({
    getHeight: () => height,
    setHeight,
    min: 160,
    max: 800,
    onEnd: () => fitAllTerminals(context),
  })

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
      {/* Resize handle */}
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
                  setActiveTerminal(context, id)
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

