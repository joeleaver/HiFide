import { Stack, Text, ScrollArea, Badge, Group, UnstyledButton } from '@mantine/core'
import { IconTrash, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useAppStore } from '../store/app'

export default function AgentDebugPanel() {
  const debugLogs = useAppStore((s) => s.debugLogs)
  const clearDebugLogs = useAppStore((s) => s.clearDebugLogs)
  const debugPanelCollapsed = useAppStore((s) => s.debugPanelCollapsed)
  const setDebugPanelCollapsed = useAppStore((s) => s.setDebugPanelCollapsed)

  const getLevelColor = (level: 'info' | 'warning' | 'error') => {
    switch (level) {
      case 'info': return 'blue'
      case 'warning': return 'yellow'
      case 'error': return 'red'
    }
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const timeStr = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    const ms = date.getMilliseconds().toString().padStart(3, '0')
    return `${timeStr}.${ms}`
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e' }}>
      {/* Header bar - always visible */}
      <div
        style={{
          padding: debugPanelCollapsed ? '6px 12px' : '6px 12px 5px 12px',
          borderBottom: debugPanelCollapsed ? 'none' : '1px solid #3e3e42',
          backgroundColor: '#252526',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">
            AGENT DEBUG
          </Text>
          {debugLogs.length > 0 && (
            <Badge size="xs" variant="light" color="gray">
              {debugLogs.length}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          {debugLogs.length > 0 && !debugPanelCollapsed && (
            <UnstyledButton
              onClick={clearDebugLogs}
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
              <IconTrash size={14} />
            </UnstyledButton>
          )}
          <UnstyledButton
            onClick={() => setDebugPanelCollapsed(!debugPanelCollapsed)}
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
            {debugPanelCollapsed ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </UnstyledButton>
        </Group>
      </div>

      {/* Content area - hidden when collapsed */}
      {!debugPanelCollapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {debugLogs.length === 0 ? (
            <div style={{ padding: '12px' }}>
              <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
                No debug logs yet. Logs will appear here when the agent performs actions.
              </Text>
            </div>
          ) : (
            <ScrollArea style={{ height: '100%' }} type="auto">
              <div style={{ padding: '12px' }}>
                <Stack gap={4}>
                  {debugLogs.map((log, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: '#252526',
                        borderRadius: '4px',
                        borderLeft: `3px solid var(--mantine-color-${getLevelColor(log.level)}-6)`,
                      }}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ fontFamily: 'monospace', minWidth: '90px' }}
                        >
                          {formatTime(log.timestamp)}
                        </Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color={getLevelColor(log.level)}
                          style={{ minWidth: '50px', textAlign: 'center' }}
                        >
                          {log.level.toUpperCase()}
                        </Badge>
                        <Badge
                          size="xs"
                          variant="outline"
                          color="gray"
                          style={{ minWidth: '60px', textAlign: 'center' }}
                        >
                          {log.category}
                        </Badge>
                      </Group>
                      <Text
                        size="xs"
                        mt={4}
                        style={{
                          fontFamily: 'monospace',
                          wordBreak: 'break-word',
                          color: '#ccc',
                        }}
                      >
                        {log.message}
                      </Text>
                      {log.data && (
                        <Text
                          size="xs"
                          mt={2}
                          c="dimmed"
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            wordBreak: 'break-all',
                          }}
                        >
                          {JSON.stringify(log.data, null, 2)}
                        </Text>
                      )}
                    </div>
                  ))}
                </Stack>
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}

