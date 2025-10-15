import { Stack, Text, ScrollArea, Badge, Group, UnstyledButton } from '@mantine/core'
import { IconTrash, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useAppStore, selectDebugPanelCollapsed } from '../store'

export default function AgentDebugPanel() {
  // Use selectors for better performance
  const debugPanelCollapsed = useAppStore(selectDebugPanelCollapsed)

  // Flow events
  const flowEvents = useAppStore((s) => s.feEvents)

  // Get actions
  const { setDebugPanelCollapsed, feClearLogs } = useAppStore()

  // Clear flow events
  const handleClearAll = () => {
    feClearLogs()
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
            FLOW DEBUG
          </Text>
          {flowEvents.length > 0 && (
            <Badge size="xs" variant="light" color="gray">
              {flowEvents.length}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          {flowEvents.length > 0 && !debugPanelCollapsed && (
            <UnstyledButton
              onClick={handleClearAll}
              title="Clear all logs"
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
          {flowEvents.length === 0 ? (
            <div style={{ padding: '12px' }}>
              <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
                No flow events yet. Events will appear here when the flow executes.
              </Text>
            </div>
          ) : (
            <ScrollArea style={{ height: '100%' }} type="auto">
              <div style={{ padding: '12px' }}>
                <Stack gap={4}>
                  {/* Flow Events */}
                  {flowEvents.map((event, idx) => (
                    <div
                      key={`flow-${idx}`}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: '#252526',
                        borderRadius: '4px',
                        borderLeft: `3px solid #a855f7`,
                      }}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ fontFamily: 'monospace', minWidth: '90px' }}
                        >
                          {formatTime(event.timestamp)}
                        </Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color="violet"
                          style={{ minWidth: '50px', textAlign: 'center' }}
                        >
                          FLOW
                        </Badge>
                        <Badge
                          size="xs"
                          variant="outline"
                          color="gray"
                          style={{ minWidth: '60px', textAlign: 'center' }}
                        >
                          {event.type}
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
                        {event.nodeId ? `Node: ${event.nodeId}` : (event as any).message || ''}
                      </Text>
                      {event.error && (
                        <Text
                          size="xs"
                          mt={2}
                          c="red.4"
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {event.error}
                        </Text>
                      )}
                      {event.data && (
                        <Text
                          size="xs"
                          mt={2}
                          c="dimmed"
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2)}
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

