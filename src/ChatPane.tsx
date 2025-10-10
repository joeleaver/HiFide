import { useEffect, useRef, useState } from 'react'
import { Group, Stack, Textarea, Card, ScrollArea, Text, Loader, ActionIcon } from '@mantine/core'
import { IconPlayerStop } from '@tabler/icons-react'
import { useAppStore } from './store/app'
import Markdown from './components/Markdown'
import StreamingMarkdown from './components/StreamingMarkdown'

export default function ChatPane() {
  const [input, setInput] = useState('')
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentId)
  const currentRequestId = useAppStore((s) => s.currentRequestId)
  const streamingText = useAppStore((s) => s.streamingText)
  const activity = useAppStore((s) => s.getActivityForRequest(s.currentRequestId || ''))
  const startChatRequest = useAppStore((s) => s.startChatRequest)
  const stopCurrentRequest = useAppStore((s) => s.stopCurrentRequest)
  const ensureLlmIpcSubscription = useAppStore((s) => s.ensureLlmIpcSubscription)

  const messages = (sessions.find((sess) => sess.id === currentId)?.messages) || []

  // Ref for the scroll area viewport
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change or streaming text updates
  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
    }
  }, [messages, streamingText, currentId])

  useEffect(() => {
    try { ensureLlmIpcSubscription() } catch {}
  }, [ensureLlmIpcSubscription])



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentRequestId) {
        e.preventDefault(); stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentRequestId])

  const send = async () => {
    const text = input.trim()
    if (!text) return
    await startChatRequest(text)
    setInput('')
  }

  const stop = async () => {
    await stopCurrentRequest()
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
        viewportRef={scrollViewportRef}
      >
        <Stack gap="sm" pr="md">
          {messages.map((m, i) => (
            <Card
              key={i}
              withBorder
              style={{
                backgroundColor: m.role === 'user' ? '#1e3a5f' : '#252526',
                marginLeft: m.role === 'user' ? '40px' : '0',
                borderColor: m.role === 'user' ? '#2b5a8e' : '#3e3e42',
              }}
            >
              {m.role === 'assistant' ? <Markdown content={m.content} /> : <Text>{m.content}</Text>}
            </Card>
          ))}
          {currentRequestId && (
            <Card withBorder style={{ backgroundColor: '#252526', position: 'relative' }}>
              <StreamingMarkdown content={streamingText} />
              {/* Inline activity badges (MVP) */}
              {activity.length > 0 && (
                <Stack gap={4} mt="sm">
                  {activity.map((ev, idx) => (
                    <Text key={idx} size="xs" c={ev.kind === 'ToolFailed' ? 'red.4' : 'dimmed'}>
                      {ev.kind === 'ToolStarted' && `🛠️ ${ev.tool} started`}
                      {ev.kind === 'ToolCompleted' && `✅ ${ev.tool} completed`}
                      {ev.kind === 'ToolFailed' && `❌ ${ev.tool} failed: ${ev.error}`}
                      {ev.kind === 'FileEditApplied' && `✏️ files: ${(ev.files || []).join(', ')}`}
                      {ev.summary ? ` — ${ev.summary}` : ''}
                    </Text>
                  ))}
                </Stack>
              )}
              <Group
                gap="xs"
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  right: '12px',
                  backgroundColor: '#252526',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
              >
                <Loader size="xs" />
                <Text c="dimmed" size="sm">
                  Streaming…
                </Text>
                <ActionIcon
                  size="sm"
                  variant="light"
                  color="red"
                  onClick={stop}
                  title="Stop"
                >
                  <IconPlayerStop size={16} />
                </ActionIcon>
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

