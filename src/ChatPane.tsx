import { useEffect, useRef, useState } from 'react'
import { Button, Group, Stack, Textarea, Title, Card, ScrollArea, Text, Loader } from '@mantine/core'
import { useAppStore } from './store/app'
import { useChatStore } from './store/chat'
import Markdown from './components/Markdown'
import { notifications } from '@mantine/notifications'

export default function ChatPane() {
  const [input, setInput] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const conversations = useChatStore((s) => s.conversations)
  const currentId = useChatStore((s) => s.currentId)
  const addUserMessage = useChatStore((s) => s.addUserMessage)

  const getCurrentMessages = useChatStore((s) => s.getCurrentMessages)
  const messages = (conversations.find((c) => c.id === currentId)?.messages) || []
  const [streamingText, setStreamingText] = useState('')
  const streamingRef = useRef('')
  const retryCountRef = useRef(0)
  const { selectedModel, selectedProvider, autoRetry, autoEnforceEditsSchema } = useAppStore()

  useEffect(() => {
    const onChunk = (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      streamingRef.current += payload.content
      setStreamingText(streamingRef.current)
    }
    const onDone = (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      useChatStore.getState().addAssistantMessage(streamingRef.current)
      streamingRef.current = ''
      setStreamingText('')
      setRequestId(null)
    }
    const onErr = async (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      const prevMessages = useChatStore.getState().getCurrentMessages()
      streamingRef.current = ''
      setStreamingText('')
      setRequestId(null)
      if (autoRetry && retryCountRef.current < 1) {
        retryCountRef.current += 1
        const rid2 = crypto.randomUUID()
        setRequestId(rid2)
        await window.llm?.agentStart?.(rid2, prevMessages, selectedModel, selectedProvider)
        return
      }
      notifications.show({ color: 'red', title: 'LLM error', message: String(payload.error) })
    }
    const ipc = window.ipcRenderer
    ipc?.on('llm:chunk', onChunk)
    ipc?.on('llm:done', onDone)
    ipc?.on('llm:error', onErr)
    return () => {
      ipc?.off('llm:chunk', onChunk)
      ipc?.off('llm:done', onDone)
      ipc?.off('llm:error', onErr)
    }
  }, [requestId])



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && requestId) {
        e.preventDefault(); stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestId])

  const send = async () => {
    if (!input.trim() || requestId) return
    const rid = crypto.randomUUID()
    setRequestId(rid)
    retryCountRef.current = 0
    const userText = input.trim()
    const prev = getCurrentMessages()
    const toSend = [...prev, { role: 'user' as const, content: userText }]
    addUserMessage(userText)
    setInput('')

    // Heuristic to detect code-change intent
    const isCodeChangeIntent = (t: string) => /\b(edit|change|modify|refactor|fix|update|replace)\b/i.test(t)

    // Structured edits schema when requested
    const responseSchema = autoEnforceEditsSchema && isCodeChangeIntent(userText)
      ? {
          name: 'edits_response',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              explanation: { type: 'string' },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', enum: ['replaceOnce', 'insertAfterLine', 'replaceRange'] },
                    path: { type: 'string' },
                    oldText: { type: 'string' },
                    newText: { type: 'string' },
                    line: { type: 'integer' },
                    start: { type: 'integer' },
                    end: { type: 'integer' },
                    text: { type: 'string' },
                  },
                  required: ['type', 'path'],
                },
              },
            },
            required: ['edits'],
          },
          strict: false,
        }
      : undefined

    await window.llm?.agentStart?.(rid, toSend, selectedModel, selectedProvider, undefined, responseSchema)
  }

  const stop = async () => {
    if (!requestId) return
    await window.llm?.cancel?.(requestId)
    setRequestId(null)
    streamingRef.current = ''
    setStreamingText('')
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
      {/* Header */}
      <Group justify="space-between" align="center">
        <Title order={4}>Chat</Title>
        {requestId && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text c="dimmed" size="sm">
              Streaming…
            </Text>
          </Group>
        )}
      </Group>

      {/* Messages Area - takes remaining space */}
      <ScrollArea
        style={{ flex: 1 }}
        scrollbars="y"
        type="auto"
      >
        <Stack gap="sm" pr="md">
          {messages.map((m, i) => (
            <Card key={i} withBorder style={{ backgroundColor: '#252526' }}>
              <Text fw={600} size="sm" c="dimmed" mb="xs">
                {m.role}
              </Text>
              {m.role === 'assistant' ? <Markdown content={m.content} /> : <Text>{m.content}</Text>}
            </Card>
          ))}
          {requestId && (
            <Card withBorder style={{ backgroundColor: '#252526' }}>
              <Text fw={600} size="sm" c="dimmed" mb="xs">
                assistant
              </Text>
              <Text>{streamingText}</Text>
            </Card>
          )}
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      <Stack gap="sm">
        <Textarea
          placeholder="Ask GPT-5..."
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
        <Group>
          <Button onClick={send} disabled={!input.trim() || !!requestId}>
            Send
          </Button>
          <Button variant="light" color="red" onClick={stop} disabled={!requestId}>
            Stop
          </Button>
        </Group>
      </Stack>
    </Stack>
  )
}

