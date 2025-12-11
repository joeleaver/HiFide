import { Group, Text, UnstyledButton, Badge, ActionIcon, Popover, TextInput, Stack, Button, Tooltip } from '@mantine/core'
import { IconPlus, IconX, IconChevronUp, IconChevronDown, IconCopy, IconEdit, IconSettings } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTerminalStore } from '../store/terminal'
import { useTerminalTabs, type TerminalTabModel } from '../store/terminalTabs'
import { usePanelResize } from '../hooks/usePanelResize'
import TerminalView from './TerminalView'
import { getBackendClient } from '../lib/backend/bootstrap'

export default function TerminalPanel() {
  // Get tabs from store (not local state!)
  const tabs = useTerminalTabs((s) => s.explorerTabs)
  const activeTab = useTerminalTabs((s) => s.explorerActive)
  const hydrateTabs = useTerminalTabs((s) => s.hydrateTabs)
  const addExplorerTab = useTerminalTabs((s) => s.addExplorerTab)
  const closeExplorerTab = useTerminalTabs((s) => s.closeExplorerTab)
  const setExplorerActive = useTerminalTabs((s) => s.setExplorerActive)
  const renameExplorerTab = useTerminalTabs((s) => s.renameExplorerTab)
  const duplicateExplorerTab = useTerminalTabs((s) => s.duplicateExplorerTab)
  const updateExplorerMetadata = useTerminalTabs((s) => s.updateExplorerMetadata)

  const [panelHeight, setPanelHeight] = useState<number>(300)
  const [renameState, setRenameState] = useState<{ tabId: string; value: string } | null>(null)
  const [settingsState, setSettingsState] = useState<{ tabId: string; cwd: string; shell: string } | null>(null)

  // Use renderer-local terminal store for xterm operations and UI state
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const open = useTerminalStore((s) => s.explorerTerminalPanelOpen)
  const setTerminalPanelOpen = useTerminalStore((s) => s.setTerminalPanelOpen)
  const disposeSession = useTerminalStore((s) => s.disposeSession)

  // Hydrate tabs and height on mount
  useEffect(() => {
    hydrateTabs()
    ;(async () => {
      try {
        const w: any = await getBackendClient()?.rpc('ui.getWindowState', {})
        const ws = w?.windowState || {}
        setPanelHeight(
          typeof ws.explorerTerminalPanelHeight === 'number' ? ws.explorerTerminalPanelHeight : 300
        )
      } catch {}
    })()
  }, [hydrateTabs])

  const addTab = () => { addExplorerTab() }

  const closeTab = async (id: string) => {
    try { await disposeSession(id) } catch {}
    closeExplorerTab(id)
  }

  const startRename = (tab: TerminalTabModel) => {
    setRenameState({ tabId: tab.id, value: tab.title })
  }

  const commitRename = () => {
    if (!renameState) return
    renameExplorerTab(renameState.tabId, renameState.value)
    setRenameState(null)
  }

  const cancelRename = () => {
    setRenameState(null)
  }

  const openSettings = (tab: TerminalTabModel) => {
    setSettingsState({ tabId: tab.id, cwd: tab.cwd || '', shell: tab.shell || '' })
  }

  const closeSettings = () => setSettingsState(null)

  const saveSettings = async () => {
    if (!settingsState) return
    updateExplorerMetadata(settingsState.tabId, { cwd: settingsState.cwd, shell: settingsState.shell })
    try { await disposeSession(settingsState.tabId) } catch {}
    setSettingsState(null)
  }

  const onToggleClick = () => {
    setTerminalPanelOpen('explorer', !open)
  }

  const { onMouseDown, isResizingRef } = usePanelResize({
    initialHeight: panelHeight,
    setHeight: (newHeight) => {
      setPanelHeight(newHeight)
      void getBackendClient()?.rpc('ui.updateWindowState', {
        updates: {
          explorerTerminalPanelHeight: newHeight
        }
      })
    },
    min: 160,
    max: 800,
    handlePosition: 'top',
    onEnd: () => {
      // Fit all terminals after resize
      tabs.forEach((tab) => fitTerminal(tab.id))
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
            TERMINAL
          </Text>
          {tabs.length > 1 && (
            <Badge size="xs" variant="light" color="gray">
              {tabs.length}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          {open && (
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
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id
              const isRenaming = renameState?.tabId === tab.id
              const isSettingsOpen = settingsState?.tabId === tab.id
              return (
              <div
                key={tab.id}
                onClick={() => setExplorerActive(tab.id)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  backgroundColor: isActive ? '#1e1e1e' : 'transparent',
                  borderTop: isActive ? '1px solid #007acc' : '1px solid transparent',
                  borderLeft: '1px solid #3e3e42',
                  borderRight: '1px solid #3e3e42',
                  color: isActive ? '#ffffff' : '#888888',
                  fontSize: '13px',
                }}
              >
                {isRenaming ? (
                  <TextInput
                    value={renameState?.value || ''}
                    autoFocus
                    size="xs"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameState((prev) => (prev ? { ...prev, value: e.currentTarget.value } : prev))}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                    }}
                    styles={{
                      input: {
                        backgroundColor: '#1e1e1e',
                        color: '#fff',
                        height: 22,
                      },
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(tab)
                    }}
                  >
                    {tab.title}
                  </span>
                )}
                <Group gap={4} align="center">
                  <Tooltip label="Rename" withinPortal>
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      color="gray"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(tab)
                      }}
                    >
                      <IconEdit size={12} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Duplicate" withinPortal>
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      color="gray"
                      onClick={(e) => {
                        e.stopPropagation()
                        duplicateExplorerTab(tab.id)
                      }}
                    >
                      <IconCopy size={12} />
                    </ActionIcon>
                  </Tooltip>
                  <Popover
                    opened={isSettingsOpen}
                    onChange={(opened) => {
                      if (!opened) setSettingsState((prev) => (prev?.tabId === tab.id ? null : prev))
                    }}
                    withinPortal
                    position="bottom-start"
                    shadow="md"
                  >
                    <Popover.Target>
                      <ActionIcon
                        variant="subtle"
                        size="xs"
                        color="gray"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isSettingsOpen) {
                            closeSettings()
                          } else {
                            openSettings(tab)
                          }
                        }}
                      >
                        <IconSettings size={12} />
                      </ActionIcon>
                    </Popover.Target>
                    <Popover.Dropdown bg="#1e1e1e" px="md" py="sm" w={260}>
                      <Stack gap="xs">
                        <Text size="xs" fw={600} c="dimmed">
                          Terminal settings
                        </Text>
                        <TextInput
                          label="Working directory"
                          value={settingsState?.cwd || ''}
                          placeholder="Workspace root"
                          onChange={(e) => setSettingsState((prev) => (prev?.tabId === tab.id ? { ...prev, cwd: e.currentTarget.value } : prev))}
                        />
                        <TextInput
                          label="Shell"
                          value={settingsState?.shell || ''}
                          placeholder="Default"
                          onChange={(e) => setSettingsState((prev) => (prev?.tabId === tab.id ? { ...prev, shell: e.currentTarget.value } : prev))}
                        />
                        <Group justify="space-between" mt="xs">
                          <Button variant="subtle" size="xs" color="gray" onClick={closeSettings}>
                            Cancel
                          </Button>
                          <Button size="xs" onClick={saveSettings}>
                            Save
                          </Button>
                        </Group>
                      </Stack>
                    </Popover.Dropdown>
                  </Popover>
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation()
                      void closeTab(tab.id)
                    }}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                </Group>
              </div>
              )
            })}
          </div>

          {/* Terminal views */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {tabs.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                <Text size="sm">No terminals open. Click + to create one.</Text>
              </div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: activeTab === tab.id ? 'block' : 'none',
                  }}
                >
                  <TerminalView tabId={tab.id} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

