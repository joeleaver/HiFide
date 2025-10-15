import { Group, Stack, Textarea, Card, ScrollArea, Text, Loader, Badge } from '@mantine/core'
import { IconClock } from '@tabler/icons-react'
import { useAppStore, selectSessions, selectCurrentId } from './store'
import Markdown from './components/Markdown'
import StreamingMarkdown from './components/StreamingMarkdown'
import { useRef, useEffect } from 'react'

export default function ChatPane() {
  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)

  // Flow execution state - actions don't cause re-renders
  const feResume = useAppStore((s) => s.feResume)

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)
  const feStreamingText = useAppStore((s) => s.feStreamingText)
  const currentTurnToolCalls = useAppStore((s) => s.currentTurnToolCalls)

  // Chat input from store - this changes on every keystroke
  const input = useAppStore((s) => s.chatInput)
  const setInput = useAppStore((s) => s.setChatInput)

  const messages = (sessions.find((sess) => sess.id === currentId)?.messages) || []

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

  // Auto-scroll when messages/streaming changes, but only if user is near bottom
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !shouldAutoScrollRef.current) return

    // Scroll to bottom
    viewport.scrollTop = viewport.scrollHeight
  }, [messages.length, feStreamingText, currentTurnToolCalls.length])

  const send = async () => {
    const text = input.trim()
    if (!text) return

    // Resume flow with user input
    setInput('')
    await feResume(text)
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
          {messages.map((m, i) => (
            <div key={i}>
              {/* Intent and tool calls that happened before this message */}
              {(m.intent || (m.toolCalls && m.toolCalls.length > 0)) && (
                <Card withBorder style={{ backgroundColor: '#1e1e1e', padding: '8px 12px', marginBottom: '8px' }}>
                  <Group gap="xs" wrap="wrap">
                    {/* Intent badge */}
                    {m.intent && (
                      <Badge
                        variant="light"
                        color="orange"
                        size="sm"
                      >
                        🎯 {m.intent}
                      </Badge>
                    )}

                    {/* Tool call badges */}
                    {m.toolCalls?.map((toolCall, tcIdx) => (
                      <Badge
                        key={tcIdx}
                        variant={toolCall.status === 'running' ? 'filled' : 'light'}
                        color={
                          toolCall.status === 'running' ? 'orange' :
                          toolCall.status === 'error' ? 'red' : 'green'
                        }
                        size="sm"
                        leftSection={toolCall.status === 'running' ? <Loader size={12} /> : undefined}
                        title={toolCall.error || new Date(toolCall.timestamp).toLocaleTimeString()}
                      >
                        🔧 {toolCall.toolName}
                      </Badge>
                    ))}
                  </Group>
                </Card>
              )}

              {/* Message */}
              <Card
                withBorder
                style={{
                  backgroundColor: m.role === 'user' ? '#1e3a5f' : '#252526',
                  marginLeft: m.role === 'user' ? '40px' : '0',
                  borderColor: m.role === 'user' ? '#2b5a8e' : '#3e3e42',
                }}
              >
                {m.role === 'assistant' ? <Markdown content={m.content} /> : <Text>{m.content}</Text>}
              </Card>
            </div>
          ))}

          {/* Current turn tool calls (before assistant message is added) */}
          {currentTurnToolCalls.length > 0 && (
            <Card withBorder style={{ backgroundColor: '#1e1e1e', padding: '8px 12px' }}>
              <Group gap="xs" wrap="wrap">
                {currentTurnToolCalls.map((toolCall, idx) => (
                  <Badge
                    key={idx}
                    variant={toolCall.status === 'running' ? 'filled' : 'light'}
                    color={
                      toolCall.status === 'running' ? 'orange' :
                      toolCall.status === 'error' ? 'red' : 'green'
                    }
                    size="sm"
                    leftSection={toolCall.status === 'running' ? <Loader size={12} /> : undefined}
                    title={toolCall.error || new Date(toolCall.timestamp).toLocaleTimeString()}
                  >
                    🔧 {toolCall.toolName}
                  </Badge>
                ))}
              </Group>
            </Card>
          )}

          {/* Streaming response */}
          {feStreamingText && (
            <Card withBorder style={{ backgroundColor: '#252526', position: 'relative' }}>
              <StreamingMarkdown content={feStreamingText} />
              <Group gap="xs" style={{ position: 'absolute', bottom: '12px', right: '12px' }}>
                {/* Streaming indicator - show whenever LLM is active */}
                {feStatus === 'running' && (
                  <Badge
                    variant="light"
                    color="blue"
                    size="sm"
                    leftSection={<Loader size={12} />}
                  >
                    Streaming
                  </Badge>
                )}
              </Group>
            </Card>
          )}

          {/* LLM active but not streaming yet - show spinner */}
          {!feStreamingText && feStatus === 'running' && (
            <Card
              withBorder
              style={{
                backgroundColor: '#1a2a3a',
                borderColor: '#4dabf7',
                padding: '12px 16px',
              }}
            >
              <Group gap="sm" align="center">
                <Loader size={18} color="#4dabf7" />
                <Badge variant="light" color="blue" size="sm" leftSection={<Loader size={12} />}>
                  Streaming
                </Badge>
              </Group>
            </Card>
          )}

          {/* Waiting for user input */}
          {feStatus === 'waitingForInput' && (
            <Card
              withBorder
              style={{
                backgroundColor: '#1a2a1a',
                borderColor: '#4ade80',
                padding: '12px 16px',
              }}
            >
              <Group gap="sm" align="center">
                <IconClock size={18} color="#4ade80" />
                <Badge variant="light" color="green" size="lg">
                  Waiting for user input
                </Badge>
              </Group>
            </Card>
          )}
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      <Textarea
        placeholder="Ask your agent... (Ctrl+Enter to send)"
        autosize
        minRows={2}
        maxRows={6}
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
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

