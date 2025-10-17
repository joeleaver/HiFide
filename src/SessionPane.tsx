import { Stack, Textarea, Card, ScrollArea, Text, Badge } from '@mantine/core'
import { useAppStore, useDispatch, selectSessions, selectCurrentId } from './store'
import Markdown from './components/Markdown'
import StreamingMarkdown from './components/StreamingMarkdown'
import { BadgeGroup } from './components/BadgeGroup'
import { NodeOutputBox } from './components/NodeOutputBox'
import { FlowStatusIndicator } from './components/FlowStatusIndicator'
import type { SessionItem } from './store'
import { useRef, useEffect } from 'react'

export default function SessionPane() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)
  const feStreamingText = useAppStore((s) => s.feStreamingText)

  // Session input from store - this changes on every keystroke
  const input = useAppStore((s) => s.sessionInput)

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
  }, [sessionItems.length, feStreamingText])

  const send = async () => {
    const text = input.trim()
    if (!text) return

    // Resume flow with user input
    dispatch('setSessionInput', '')
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
          {/* Session timeline rendering */}
          {sessionItems.map((item) => {
            if (item.type === 'badge-group') {
              return <BadgeGroup key={item.id} badgeGroup={item} />
            }

            if (item.type === 'message') {
              // User messages: simple card without NodeOutputBox
              if (item.role === 'user') {
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

              // Assistant messages: use NodeOutputBox
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
          })}

          {/* Streaming response */}
          {feStreamingText && (
            <NodeOutputBox nodeLabel="ASSISTANT" nodeKind="llmRequest">
              <div style={{ position: 'relative' }}>
                <StreamingMarkdown content={feStreamingText} />
                {feStatus === 'running' && (
                  <Badge
                    variant="light"
                    color="blue"
                    size="sm"
                    style={{ position: 'absolute', bottom: 0, right: 0 }}
                  >
                    Streaming
                  </Badge>
                )}
              </div>
            </NodeOutputBox>
          )}

          {/* Flow status indicator - shows running/waiting/stopped states */}
          {!feStreamingText && <FlowStatusIndicator status={feStatus} />}
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      <Textarea
        placeholder="Ask your agent... (Ctrl+Enter to send)"
        autosize
        minRows={2}
        maxRows={6}
        value={input}
        onChange={(e) => dispatch('setSessionInput', e.currentTarget.value)}
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

