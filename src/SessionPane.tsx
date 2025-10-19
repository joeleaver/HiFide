import { Stack, Textarea, Card, ScrollArea, Text, Group, Badge as MantineBadge } from '@mantine/core'
import { useAppStore, useDispatch, selectSessions, selectCurrentId } from './store'
import Markdown from './components/Markdown'

import { NodeOutputBox } from './components/NodeOutputBox'
import { FlowStatusIndicator } from './components/FlowStatusIndicator'
import type { SessionItem, NodeExecutionBox } from '../electron/store/types'
import { useRef, useEffect, useState } from 'react'

export default function SessionPane() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)


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
          {/* Simplified session timeline rendering */}
          {sessionItems.map((item) => {
            // User message
            if (item.type === 'message' && item.role === 'user') {
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

            // Node execution box
            if (item.type === 'node-execution') {
              const box = item as NodeExecutionBox

              // Merge consecutive text items to fix markdown rendering
              // (debounced flushing can split markdown syntax across multiple text items)
              const mergedContent: Array<{ type: 'text'; text: string } | { type: 'badge'; badge: any }> = []
              let textBuffer = ''

              for (const contentItem of box.content) {
                if (contentItem.type === 'text') {
                  textBuffer += contentItem.text
                } else {
                  // Non-text item (badge) - flush accumulated text first
                  if (textBuffer) {
                    mergedContent.push({ type: 'text', text: textBuffer })
                    textBuffer = ''
                  }
                  mergedContent.push(contentItem)
                }
              }

              // Flush any remaining text
              if (textBuffer) {
                mergedContent.push({ type: 'text', text: textBuffer })
              }

              return (
                <NodeOutputBox
                  key={box.id}
                  nodeLabel={box.nodeLabel}
                  nodeType={box.nodeKind}
                  provider={box.provider}
                  model={box.model}
                  cost={box.cost}
                >
                  <Stack gap="xs">
                    {mergedContent.map((contentItem, idx) => {
                      if (contentItem.type === 'text') {
                        return <Markdown key={idx} content={contentItem.text} />
                      }
                      if (contentItem.type === 'badge') {
                        const badge = contentItem.badge
                        return (
                          <MantineBadge
                            key={idx}
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
                        )
                      }
                      return null
                    })}
                  </Stack>
                </NodeOutputBox>
              )
            }

            return null
          })}

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

