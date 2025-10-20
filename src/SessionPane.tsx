import { Stack, Textarea, Card, ScrollArea, Text, Badge as MantineBadge } from '@mantine/core'
import { useAppStore, useDispatch, selectCurrentId } from './store'
import { useUiStore } from './store/ui'
import Markdown from './components/Markdown'

import { NodeOutputBox } from './components/NodeOutputBox'
import { FlowStatusIndicator } from './components/FlowStatusIndicator'
import type { NodeExecutionBox } from '../electron/store/types'
import { useRef, useEffect, useMemo, memo } from 'react'

// Separate input component to prevent re-renders when parent updates
const SessionInput = memo(function SessionInput() {
  const dispatch = useDispatch()
  const inputValue = useUiStore((s) => s.sessionInputValue || '')
  const setInputValue = useUiStore((s) => s.setSessionInputValue)

  const send = async () => {
    const text = inputValue.trim()
    if (!text) return

    // Clear input and resume flow
    setInputValue('')
    await dispatch('feResume', { userInput: text })
  }

  return (
    <Textarea
      placeholder="Ask your agent... (Ctrl+Enter to send)"
      autosize
      minRows={2}
      maxRows={6}
      value={inputValue}
      onChange={(e) => setInputValue(e.currentTarget.value)}
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
  )
})

export default function SessionPane() {
  // PERFORMANCE FIX: Only subscribe to current session's items, not entire sessions array
  // This prevents re-renders when other sessions are updated
  const currentId = useAppStore(selectCurrentId)
  const sessionItems = useAppStore((s) => {
    const currentSession = s.sessions.find((sess: any) => sess.id === currentId)
    return currentSession?.items || []
  })

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useUiStore((s) => s.shouldAutoScroll)
  const setShouldAutoScroll = useUiStore((s) => s.setShouldAutoScroll)

  // Check if user is near bottom (within 150px threshold)
  const checkIfNearBottom = () => {
    const viewport = viewportRef.current
    if (!viewport) return true

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // Consider "near bottom" if within 150px or already at bottom (accounting for rounding)
    return distanceFromBottom < 150
  }

  // Update shouldAutoScroll when user manually scrolls
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      const isNearBottom = checkIfNearBottom()
      setShouldAutoScroll(isNearBottom)
    }

    // Set initial state
    setShouldAutoScroll(checkIfNearBottom())

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [setShouldAutoScroll])

  // Auto-scroll when session items/streaming changes, but only if user is near bottom
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    // Check if we should auto-scroll
    if (!shouldAutoScroll) return

    // Use requestAnimationFrame to ensure DOM has updated before scrolling
    requestAnimationFrame(() => {
      if (viewport && shouldAutoScroll) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
  }, [sessionItems, shouldAutoScroll]) // Trigger on ANY sessionItems change, not just length

  // Memoize the expensive rendering of session items
  // Only re-render when sessionItems actually changes
  const renderedItems = useMemo(() => {
    return sessionItems.map((item: any) => {
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
          })
  }, [sessionItems]) // Only re-render when sessionItems changes

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
          {renderedItems}

          {/* Flow status indicator - shows running/waiting/stopped states */}
          <FlowStatusIndicator status={feStatus} />
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      <SessionInput />
    </Stack>
  )
}

