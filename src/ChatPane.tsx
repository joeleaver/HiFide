import { useEffect, useRef, useState } from 'react'
import { Group, Stack, Textarea, Card, ScrollArea, Text, Loader, ActionIcon } from '@mantine/core'
import { IconPlayerStop } from '@tabler/icons-react'
import { useAppStore } from './store/app'
import { useChatStore } from './store/chat'
import Markdown from './components/Markdown'
import StreamingMarkdown from './components/StreamingMarkdown'
import { notifications } from '@mantine/notifications'

export default function ChatPane() {
  const [input, setInput] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const sessions = useChatStore((s) => s.sessions)
  const currentId = useChatStore((s) => s.currentId)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const recordTokenUsage = useChatStore((s) => s.recordTokenUsage)

  const getCurrentMessages = useChatStore((s) => s.getCurrentMessages)
  const messages = (sessions.find((sess) => sess.id === currentId)?.messages) || []
  const [streamingText, setStreamingText] = useState('')
  const streamingRef = useRef('')
  const retryCountRef = useRef(0)
  const { selectedModel, selectedProvider, autoRetry, autoEnforceEditsSchema } = useAppStore()

  // Ref for accumulating chunk stats
  const chunkStatsRef = useRef({ count: 0, totalChars: 0 })

  // Ref for the scroll area viewport
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change or streaming text updates
  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
    }
  }, [messages, streamingText, currentId])

  useEffect(() => {
    const onChunk = (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      streamingRef.current += payload.content
      setStreamingText(streamingRef.current)
      // Accumulate chunk stats instead of logging each chunk
      chunkStatsRef.current.count++
      chunkStatsRef.current.totalChars += payload.content.length
    }
    const onDone = (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      useChatStore.getState().addAssistantMessage(streamingRef.current)
      streamingRef.current = ''
      setStreamingText('')
      setRequestId(null)
      // Log accumulated chunk stats
      if (chunkStatsRef.current.count > 0) {
        useAppStore.getState().addDebugLog('info', 'LLM', `Received ${chunkStatsRef.current.count} chunks (${chunkStatsRef.current.totalChars} chars total)`)
        chunkStatsRef.current = { count: 0, totalChars: 0 }
      }
      // Debug log
      useAppStore.getState().addDebugLog('info', 'LLM', 'Stream completed')
    }
    const onErr = async (_: any, payload: any) => {
      if (!requestId || payload.requestId !== requestId) return
      const prevMessages = useChatStore.getState().getCurrentMessages()
      streamingRef.current = ''
      setStreamingText('')
      setRequestId(null)
      // Log accumulated chunk stats before error
      if (chunkStatsRef.current.count > 0) {
        useAppStore.getState().addDebugLog('info', 'LLM', `Received ${chunkStatsRef.current.count} chunks (${chunkStatsRef.current.totalChars} chars total) before error`)
        chunkStatsRef.current = { count: 0, totalChars: 0 }
      }
      // Debug log
      useAppStore.getState().addDebugLog('error', 'LLM', `Error: ${payload.error}`, { error: payload.error })
      if (autoRetry && retryCountRef.current < 1) {
        retryCountRef.current += 1
        const rid2 = crypto.randomUUID()
        setRequestId(rid2)
        useAppStore.getState().addDebugLog('info', 'LLM', 'Auto-retrying request')
        const res = await window.llm?.auto?.(rid2, prevMessages, selectedModel, selectedProvider)
        try { useAppStore.getState().pushRouteRecord?.({ requestId: rid2, mode: (res as any)?.mode || 'chat', provider: selectedProvider, model: selectedModel, timestamp: Date.now() }) } catch {}
        return
      }
      notifications.show({ color: 'red', title: 'LLM error', message: String(payload.error) })
    }
    const ipc = window.ipcRenderer
    ipc?.on('llm:chunk', onChunk)
    ipc?.on('llm:done', onDone)
    ipc?.on('llm:error', onErr)

    // Listen for debug events from main process
    const onDebug = (_: any, payload: { level: 'info' | 'warning' | 'error'; category: string; message: string; data?: any }) => {
      useAppStore.getState().addDebugLog(payload.level, payload.category, payload.message, payload.data)
    }
    ipc?.on('debug:log', onDebug)

    // Listen for token usage events
    const onTokenUsage = (_: any, payload: { requestId: string; provider: string; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }) => {
      if (!requestId || payload.requestId !== requestId) return
      recordTokenUsage(payload.provider, payload.model, payload.usage)
      useAppStore.getState().addDebugLog('info', 'Tokens', `Usage: ${payload.usage.totalTokens} tokens (${payload.provider}/${payload.model})`, payload.usage)
    }
    ipc?.on('llm:token-usage', onTokenUsage)

    return () => {
      ipc?.off('llm:chunk', onChunk)
      ipc?.off('llm:done', onDone)
      ipc?.off('llm:error', onErr)
      ipc?.off('debug:log', onDebug)
      ipc?.off('llm:token-usage', onTokenUsage)
    }
  }, [requestId, recordTokenUsage])



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
    chunkStatsRef.current = { count: 0, totalChars: 0 } // Reset chunk stats for new request
    const userText = input.trim()
    const prev = getCurrentMessages()
    const toSend = [...prev, { role: 'user' as const, content: userText }]
    addUserMessage(userText)
    setInput('')

    // Debug log
    useAppStore.getState().addDebugLog('info', 'LLM', `Sending request to ${selectedProvider}/${selectedModel}`, {
      requestId: rid,
      provider: selectedProvider,
      model: selectedModel,
      messageCount: toSend.length
    })

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

    const res = await window.llm?.auto?.(rid, toSend, selectedModel, selectedProvider, undefined, responseSchema)
    try { useAppStore.getState().pushRouteRecord?.({ requestId: rid, mode: (res as any)?.mode || 'chat', provider: selectedProvider, model: selectedModel, timestamp: Date.now() }) } catch {}
  }

  const stop = async () => {
    if (!requestId) return
    await window.llm?.cancel?.(requestId)
    setRequestId(null)
    streamingRef.current = ''
    setStreamingText('')
    // Log accumulated chunk stats before stopping
    if (chunkStatsRef.current.count > 0) {
      useAppStore.getState().addDebugLog('info', 'LLM', `Received ${chunkStatsRef.current.count} chunks (${chunkStatsRef.current.totalChars} chars total) before stop`)
      chunkStatsRef.current = { count: 0, totalChars: 0 }
    }
    useAppStore.getState().addDebugLog('info', 'LLM', 'Stream stopped by user')
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
          {requestId && (
            <Card withBorder style={{ backgroundColor: '#252526', position: 'relative' }}>
              <StreamingMarkdown content={streamingText} />
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

