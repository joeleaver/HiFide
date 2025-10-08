import { Group, Stack, Text, UnstyledButton, ScrollArea, Card, Select, Button } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react'
import { useAppStore } from '../store/app'
import { useChatStore } from '../store/chat'
import ChatPane from '../ChatPane'
import TerminalPanel from './TerminalPanel'

export default function AgentView() {
  const metaPanelOpen = useAppStore((s) => s.metaPanelOpen)
  const setMetaPanelOpen = useAppStore((s) => s.setMetaPanelOpen)

  const conversations = useChatStore((s) => s.conversations)
  const currentId = useChatStore((s) => s.currentId)
  const select = useChatStore((s) => s.select)
  const newConversation = useChatStore((s) => s.newConversation)

  return (
    <Group
      gap={0}
      style={{
        flex: 1,
        height: '100%',
        overflow: 'hidden',
      }}
      align="stretch"
    >
      {/* Main Chat Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: '#1e1e1e',
          overflow: 'hidden',
        }}
      >
        {/* Conversation Selector Bar */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #3e3e42',
            backgroundColor: '#252526',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Select
            value={currentId || undefined}
            onChange={(v) => v && select(v)}
            data={conversations.map((c) => ({
              value: c.id,
              label: c.title || 'Untitled',
            }))}
            placeholder="Select conversation"
            size="xs"
            style={{ flex: 1, maxWidth: 300 }}
            styles={{
              input: {
                backgroundColor: '#1e1e1e',
                border: '1px solid #3e3e42',
                color: '#cccccc',
              },
            }}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => newConversation()}
          >
            New
          </Button>
        </div>

        {/* Chat + Terminal Panel (bottom) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPane />
          </div>
          {/* Bottom panel (agent context) */}
          <div style={{ borderTop: '1px solid #3e3e42' }}>
            <TerminalPanel context="agent" />
          </div>
        </div>
      </div>

      {/* Meta Panel */}
      {metaPanelOpen && (
        <div
          style={{
            width: 300,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Meta Panel Header */}
          <Group
            justify="space-between"
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #3e3e42',
              backgroundColor: '#2d2d30',
            }}
          >
            <Text size="sm" fw={600}>
              Agent Info
            </Text>
            <UnstyledButton
              onClick={() => setMetaPanelOpen(false)}
              style={{
                color: '#cccccc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#cccccc'
              }}
            >
              <IconChevronRight size={16} />
            </UnstyledButton>
          </Group>

          {/* Meta Panel Content */}
          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="md">
              <Card withBorder style={{ backgroundColor: '#1e1e1e' }}>
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">
                    CONTEXT
                  </Text>
                  <Text size="sm">No active context</Text>
                </Stack>
              </Card>

              <Card withBorder style={{ backgroundColor: '#1e1e1e' }}>
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">
                    TOKEN USAGE
                  </Text>
                  <Text size="sm">0 tokens used</Text>
                </Stack>
              </Card>

              <Card withBorder style={{ backgroundColor: '#1e1e1e' }}>
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">
                    THINKING
                  </Text>
                  <Text size="sm" c="dimmed">
                    Waiting for input...
                  </Text>
                </Stack>
              </Card>
            </Stack>
          </ScrollArea>
        </div>
      )}

      {/* Toggle button when panel is closed */}
      {!metaPanelOpen && (
        <UnstyledButton
          onClick={() => setMetaPanelOpen(true)}
          style={{
            width: 24,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cccccc',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2d2d30'
            e.currentTarget.style.color = '#ffffff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#252526'
            e.currentTarget.style.color = '#cccccc'
          }}
        >
          <IconChevronLeft size={16} />
        </UnstyledButton>
      )}
    </Group>
  )
}

