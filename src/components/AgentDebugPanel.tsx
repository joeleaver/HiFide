import { Stack, Text, ScrollArea, Badge, Group, UnstyledButton } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useAppStore, useDispatch } from '../store'
import { useUiStore } from '../store/ui'
import { useRef, useEffect } from 'react'
import CollapsiblePanel from './CollapsiblePanel'

import { useRerenderTrace } from '../utils/perf'

export default function AgentDebugPanel() {
  const dispatch = useDispatch()

  // Read persisted state from main store
  const persistedCollapsed = useAppStore((s) => s.windowState.debugPanelCollapsed)
  const persistedHeight = useAppStore((s) => s.windowState.debugPanelHeight)

  // Use UI store for local state
  const collapsed = useUiStore((s) => s.debugPanelCollapsed)
  const height = useUiStore((s) => s.debugPanelHeight)
  const userHasScrolledUp = useUiStore((s) => s.debugPanelUserScrolledUp)
  const setCollapsed = useUiStore((s) => s.setDebugPanelCollapsed)
  const setHeight = useUiStore((s) => s.setDebugPanelHeight)
  const setUserHasScrolledUp = useUiStore((s) => s.setDebugPanelUserScrolledUp)

  // Sync UI store with persisted state ONLY on mount
  // Don't sync during runtime to avoid race conditions
  useEffect(() => {
    setCollapsed(persistedCollapsed)
    setHeight(persistedHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Read runtime (non-persisted) flow events from main store to avoid heavy session updates
  const flowEvents = useAppStore((s) => s.feEvents)

  // Dev-only: concise rerender trace
  useRerenderTrace('AgentDebugPanel', {
    collapsed: Boolean(collapsed),
    height: Number(height || 0),
    eventsLen: flowEvents.length,
    userHasScrolledUp: Boolean(userHasScrolledUp),
  })

  // Smart auto-scroll: track if user has manually scrolled up
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const prevEventsLengthRef = useRef(flowEvents.length)

  // Auto-scroll to bottom when new events arrive (unless user has scrolled up)
  useEffect(() => {
    if (flowEvents.length > prevEventsLengthRef.current && !userHasScrolledUp) {
      // New events arrived and user hasn't scrolled up - scroll to bottom
      const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
    prevEventsLengthRef.current = flowEvents.length
  }, [flowEvents.length, userHasScrolledUp])

  // Detect when user scrolls up
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const viewport = e.currentTarget
    const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 10
    setUserHasScrolledUp(!isAtBottom)
  }

  // Clear flow events
  const handleClearAll = () => {
    dispatch('feClearLogs')
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

  const clearButton = flowEvents.length > 0 && !collapsed ? (
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
  ) : null

  return (
    <CollapsiblePanel
      title="FLOW DEBUG"
      collapsed={collapsed}
      onToggleCollapse={() => {
        const newCollapsed = !collapsed
        setCollapsed(newCollapsed)
        dispatch('updateWindowState', { debugPanelCollapsed: newCollapsed })
      }}
      height={height}
      onHeightChange={(newHeight) => {
        setHeight(newHeight)
        dispatch('updateWindowState', { debugPanelHeight: newHeight })
      }}
      minHeight={150}
      maxHeight={600}
      badge={flowEvents.length > 0 ? flowEvents.length : undefined}
      actions={clearButton}
    >
      {flowEvents.length === 0 ? (
        <div style={{ padding: '12px' }}>
          <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
            No flow events yet. Events will appear here when the flow executes.
          </Text>
        </div>
      ) : (
        <ScrollArea
          ref={scrollAreaRef}
          style={{ height: '100%' }}
          type="auto"
          onScrollCapture={handleScroll}
        >
          <div style={{ padding: '12px' }}>
            <Stack gap={4}>
                  {/* Flow Events */}
                  {flowEvents.map((event: any, idx: number) => (
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
    </CollapsiblePanel>
  )
}

