import { Stack, Textarea, Card, ScrollArea, Text, Badge, Group, Badge as MantineBadge } from '@mantine/core'
import { useAppStore, useDispatch, selectSessions, selectCurrentId } from './store'
import Markdown from './components/Markdown'
import StreamingMarkdown from './components/StreamingMarkdown'
import { BadgeGroup } from './components/BadgeGroup'
import { NodeOutputBox } from './components/NodeOutputBox'
import { FlowStatusIndicator } from './components/FlowStatusIndicator'
import type { SessionItem } from './store'
import { useRef, useEffect, useState } from 'react'

export default function SessionPane() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)
  const feStreamingText = useAppStore((s) => s.feStreamingText)
  const feNodes = useAppStore((s) => s.feNodes)
  const feNodeExecutionState = useAppStore((s) => s.feNodeExecutionState)

  // Use local state for input to avoid lag on every keystroke
  const [localInput, setLocalInput] = useState('')

  const currentSession = sessions.find((sess) => sess.id === currentId)
  const sessionItems: SessionItem[] = currentSession?.items || []

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  // Check if user is near bottom (within 100px)
  const checkIfNearBottom = () => {
    const viewport = viewportRef.current
    if (!viewport) return true

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    return distanceFromBottom < 100
  }

  // Update shouldAutoScroll when user manually scrolls
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      shouldAutoScrollRef.current = checkIfNearBottom()
    }

    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll when session items/streaming changes, but only if user is near bottom
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !shouldAutoScrollRef.current) return

    // Scroll to bottom
    viewport.scrollTop = viewport.scrollHeight
  }, [sessionItems.length])

  const send = async () => {
    const text = localInput.trim()
    if (!text) return

    // Clear local input and resume flow
    setLocalInput('')
    await dispatch('feResume', text)
  }

  return (
    <Stack
      gap="md"
      style={{
        height: '100%',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Messages Area - takes remaining space */}
      <ScrollArea
        style={{ flex: 1 }}
        scrollbars="y"
        type="auto"
        viewportRef={viewportRef}
      >
        <Stack gap="sm" pr="md">
          {/* Session timeline rendering - group consecutive items with same nodeId */}
          {(() => {
            const grouped: Array<{ key: string; items: typeof sessionItems; nodeId?: string }> = []
            let currentGroup: typeof sessionItems = []
            let currentNodeId: string | undefined = undefined

            for (const item of sessionItems) {
              const itemNodeId = item.type === 'badge-group' ? item.nodeId : item.type === 'message' ? item.nodeId : undefined

              // Start new group if:
              // 1. User message (always separate)
              // 2. No nodeId (can't group)
              // 3. Different nodeId from current group
              if (
                (item.type === 'message' && item.role === 'user') ||
                !itemNodeId ||
                (currentNodeId && itemNodeId !== currentNodeId)
              ) {
                // Flush current group
                if (currentGroup.length > 0) {
                  grouped.push({ key: currentGroup[0].id, items: currentGroup, nodeId: currentNodeId })
                  currentGroup = []
                  currentNodeId = undefined
                }

                // User messages and items without nodeId go in their own group
                if (item.type === 'message' && item.role === 'user') {
                  grouped.push({ key: item.id, items: [item], nodeId: undefined })
                } else if (!itemNodeId) {
                  grouped.push({ key: item.id, items: [item], nodeId: undefined })
                } else {
                  // Start new group with this item
                  currentGroup = [item]
                  currentNodeId = itemNodeId
                }
              } else {
                // Add to current group
                if (currentGroup.length === 0) {
                  currentNodeId = itemNodeId
                }
                currentGroup.push(item)
              }
            }

            // Flush final group
            if (currentGroup.length > 0) {
              grouped.push({ key: currentGroup[0].id, items: currentGroup, nodeId: currentNodeId })
            }

            // Render grouped items
            return grouped.map((group) => {
              // Single user message
              if (group.items.length === 1 && group.items[0].type === 'message' && group.items[0].role === 'user') {
                const item = group.items[0]
                return (
                  <Card
                    key={item.id}
                    withBorder
                    p="xs"
                    style={{
                      backgroundColor: '#1e3a5f',
                      marginLeft: '40px',
                      borderColor: '#2b5a8e',
                    }}
                  >
                    <Text size="sm" c="#e0e0e0">{item.content}</Text>
                  </Card>
                )
              }

              // Single item without nodeId (shouldn't happen, but handle it)
              if (group.items.length === 1 && !group.nodeId) {
                const item = group.items[0]
                if (item.type === 'badge-group') {
                  return <BadgeGroup key={item.id} badgeGroup={item} />
                }
                if (item.type === 'message') {
                  return (
                    <NodeOutputBox
                      key={item.id}
                      nodeLabel={item.nodeLabel || 'ASSISTANT'}
                      nodeKind={item.nodeKind || 'llmRequest'}
                      provider={item.provider}
                      model={item.model}
                      cost={item.cost}
                    >
                      <Markdown content={item.content} />
                    </NodeOutputBox>
                  )
                }
                return null
              }

              // Grouped items with same nodeId - combine into single NodeOutputBox
              const firstItem = group.items[0]
              const nodeLabel = firstItem.type === 'badge-group' ? firstItem.nodeLabel : firstItem.type === 'message' ? firstItem.nodeLabel : undefined
              const nodeKind = firstItem.type === 'badge-group' ? firstItem.nodeKind : firstItem.type === 'message' ? firstItem.nodeKind : undefined
              const provider = firstItem.type === 'badge-group' ? firstItem.provider : firstItem.type === 'message' ? firstItem.provider : undefined
              const model = firstItem.type === 'badge-group' ? firstItem.model : firstItem.type === 'message' ? firstItem.model : undefined
              const cost = firstItem.type === 'badge-group' ? firstItem.cost : firstItem.type === 'message' ? firstItem.cost : undefined

              return (
                <NodeOutputBox
                  key={group.key}
                  nodeLabel={nodeLabel}
                  nodeKind={nodeKind}
                  provider={provider}
                  model={model}
                  cost={cost}
                >
                  <Stack gap="xs">
                    {group.items.map((item) => {
                      if (item.type === 'badge-group') {
                        // Render badges inline
                        return (
                          <Group key={item.id} gap="xs" wrap="wrap">
                            {item.badges.map((badge: any) => (
                              <MantineBadge
                                key={badge.id}
                                color={badge.color || 'gray'}
                                variant={badge.variant || 'light'}
                                size="sm"
                                leftSection={badge.icon}
                                tt="none"
                                style={{
                                  opacity: badge.status === 'running' ? 0.7 : 1,
                                }}
                              >
                                {badge.label}
                                {badge.status === 'running' && ' ...'}
                                {badge.status === 'error' && ' ✗'}
                              </MantineBadge>
                            ))}
                          </Group>
                        )
                      }
                      if (item.type === 'message') {
                        // Render message content inline
                        return <Markdown key={item.id} content={item.content} />
                      }
                      return null
                    })}
                  </Stack>
                </NodeOutputBox>
              )
            })
          })()}

          {/* Flow status indicator - shows running/waiting/stopped states */}
          <FlowStatusIndicator status={feStatus} />
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      <Textarea
        placeholder="Ask your agent... (Ctrl+Enter to send)"
        autosize
        minRows={2}
        maxRows={6}
        value={localInput}
        onChange={(e) => setLocalInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            send()
          }
        }}
        styles={{
          input: {
            backgroundColor: '#252526',
            border: '1px solid #3e3e42',
          },
        }}
      />
    </Stack>
  )
}

