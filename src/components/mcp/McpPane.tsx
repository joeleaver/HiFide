import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconBug,
  IconEdit,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTools,
  IconTrash,
} from '@tabler/icons-react'
import type { CreateMcpServerInput, McpServerSnapshot } from '../../../shared/mcp'
import { ScreenLoader, ListSkeleton } from '../ScreenLoader'
import { useMcpHydration } from '@/store/screenHydration'
import { useMcpServers } from '@/store/mcpServers'
import McpServerDrawer from './McpServerDrawer'

const STATUS_META: Record<McpServerSnapshot['status'], { color: string; label: string }> = {
  connected: { color: 'green', label: 'Connected' },
  connecting: { color: 'yellow', label: 'Connecting' },
  disconnected: { color: 'gray', label: 'Disconnected' },
  error: { color: 'red', label: 'Error' },
}

function formatTransport(server: McpServerSnapshot): string {
  if (server.transport.type === 'stdio') {
    const args = Array.isArray(server.transport.args) && server.transport.args.length > 0
      ? ` ${server.transport.args.join(' ')}`
      : ''
    return `${server.transport.command}${args}`
  }
  return server.transport.url
}

function formatLastSeen(timestamp?: number | null): string {
  if (!timestamp) return 'Never'
  try {
    const date = new Date(timestamp)
    return date.toLocaleString()
  } catch {
    return 'Unknown'
  }
}

interface ServerCardProps {
  server: McpServerSnapshot
  onToggle: (server: McpServerSnapshot, nextEnabled: boolean) => Promise<void>
  onRefresh: (server: McpServerSnapshot) => Promise<void>
  onTest: (server: McpServerSnapshot) => Promise<void>
  onEdit: (server: McpServerSnapshot) => void
  onDelete: (server: McpServerSnapshot) => Promise<void>
  mutating: boolean
  testing: boolean
}

function McpServerCard({ server, onToggle, onRefresh, onTest, onEdit, onDelete, mutating, testing }: ServerCardProps) {
  const status = STATUS_META[server.status]

  return (
    <Paper withBorder radius="md" p="md" bg="rgba(255,255,255,0.01)">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Group gap="sm">
              <Title order={4} c="white">
                {server.label}
              </Title>
              <Badge color={status.color}>{status.label}</Badge>
              {server.autoStart && <Badge color="blue">Auto-start</Badge>}
              {!server.enabled && <Badge color="gray">Disabled</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              {formatTransport(server)}
            </Text>
            <Text size="xs" c="dimmed">
              Last seen: {formatLastSeen(server.lastSeen)}{server.pid ? ` · PID ${server.pid}` : ''}
            </Text>
            {server.lastError && (
              <Group gap={6}>
                <IconAlertTriangle size={16} color="var(--mantine-color-red-5)" />
                <Text size="sm" c="red.4">
                  {server.lastError}
                </Text>
              </Group>
            )}
          </Stack>
          <Stack align="flex-end" gap="xs">
            <Group gap="xs">
              <Tooltip label="Test connection" withArrow>
                <ActionIcon
                  variant="subtle"
                  onClick={() => onTest(server)}
                  disabled={mutating || testing}
                >
                  {testing ? <Loader size="xs" /> : <IconBug size={18} />}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Refresh tools" withArrow>
                <ActionIcon variant="subtle" onClick={() => onRefresh(server)} disabled={mutating}>
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Edit" withArrow>
                <ActionIcon variant="subtle" onClick={() => onEdit(server)} disabled={mutating}>
                  <IconEdit size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Delete" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => onDelete(server)}
                  disabled={mutating}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed">
                Enabled
              </Text>
              <Switch
                checked={server.enabled}
                onChange={(event) => onToggle(server, event.currentTarget.checked)}
                disabled={mutating}
              />
              {mutating && <Loader size="xs" />}
            </Group>
          </Stack>
        </Group>

        <Divider variant="dashed" color="dark.5" />

        <Group gap={40} align="flex-start" wrap="wrap">
          <Stack gap={4} style={{ minWidth: 220 }}>
            <Group gap={6}>
              <IconTools size={16} />
              <Text size="sm" fw={600}>
                Tools ({server.tools.length})
              </Text>
            </Group>
            {server.tools.length === 0 ? (
              <Text size="sm" c="dimmed">
                No tools reported yet.
              </Text>
            ) : (
              <Stack gap={2}>
                {server.tools.slice(0, 4).map((tool) => (
                  <Box key={`${server.id}-${tool.name}`}>
                    <Text size="sm" fw={500} c="white">
                      {tool.name}
                    </Text>
                    {tool.description && (
                      <Text size="xs" c="dimmed">
                        {tool.description}
                      </Text>
                    )}
                  </Box>
                ))}
                {server.tools.length > 4 && (
                  <Text size="xs" c="dimmed">
                    +{server.tools.length - 4} more
                  </Text>
                )}
              </Stack>
            )}
          </Stack>

          <Stack gap={4} style={{ minWidth: 220 }}>
            <Group gap={6}>
              <IconPlugConnected size={16} />
              <Text size="sm" fw={600}>
                Resources ({server.resources.length})
              </Text>
            </Group>
            {server.resources.length === 0 ? (
              <Text size="sm" c="dimmed">
                No resources listed.
              </Text>
            ) : (
              <Stack gap={2}>
                {server.resources.slice(0, 4).map((resource) => (
                  <Box key={`${server.id}-${resource.uri}`}>
                    <Text size="sm" fw={500} c="white">
                      {resource.name || resource.uri}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {resource.uri}
                    </Text>
                  </Box>
                ))}
                {server.resources.length > 4 && (
                  <Text size="xs" c="dimmed">
                    +{server.resources.length - 4} more
                  </Text>
                )}
              </Stack>
            )}
          </Stack>
        </Group>
      </Stack>
    </Paper>
  )
}

export default function McpPane() {
  const servers = useMcpServers((s) => s.servers)
  const creating = useMcpServers((s) => s.creating)
  const loading = useMcpServers((s) => s.loading)
  const mutatingIds = useMcpServers((s) => s.mutatingIds)
  const testingIds = useMcpServers((s) => s.testingIds)
  const hydrateServers = useMcpServers((s) => s.hydrateServers)
  const createServer = useMcpServers((s) => s.createServer)
  const updateServer = useMcpServers((s) => s.updateServer)
  const deleteServer = useMcpServers((s) => s.deleteServer)
  const refreshServer = useMcpServers((s) => s.refreshServer)
  const toggleServer = useMcpServers((s) => s.toggleServer)
  const testServer = useMcpServers((s) => s.testServer)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerSnapshot | null>(null)

  const summary = useMemo(() => {
    const enabled = servers.filter((server) => server.enabled).length
    const connected = servers.filter((server) => server.status === 'connected').length
    const tools = servers.reduce((sum, server) => sum + server.tools.length, 0)
    return { enabled, connected, tools }
  }, [servers])

  const openCreateDrawer = () => {
    setEditingServer(null)
    setDrawerOpen(true)
  }

  const openEditDrawer = (server: McpServerSnapshot) => {
    setEditingServer(server)
    setDrawerOpen(true)
  }

  const handleSubmit = async (input: CreateMcpServerInput, serverId?: string) => {
    if (serverId) {
      await updateServer(serverId, {
        label: input.label,
        transport: input.transport,
        env: input.env,
        autoStart: input.autoStart,
        enabled: input.enabled,
      })
      notifications.show({
        color: 'green',
        title: 'Server updated',
        message: `${input.label} saved successfully.`,
      })
    } else {
      await createServer(input)
      notifications.show({
        color: 'green',
        title: 'Server added',
        message: `${input.label} registered.`,
      })
    }
    setDrawerOpen(false)
    setEditingServer(null)
  }

  const handleToggle = async (server: McpServerSnapshot, nextEnabled: boolean) => {
    try {
      await toggleServer(server.id, nextEnabled)
      notifications.show({
        color: nextEnabled ? 'green' : 'yellow',
        title: nextEnabled ? 'Server enabled' : 'Server disabled',
        message: `${server.label} ${nextEnabled ? 'will start connecting.' : 'is paused.'}`,
      })
    } catch (error) {
      notifications.show({ color: 'red', title: 'Toggle failed', message: String(error) })
    }
  }

  const handleRefresh = async (server: McpServerSnapshot) => {
    try {
      await refreshServer(server.id)
      notifications.show({ color: 'green', title: 'Metadata refreshed', message: `${server.label} updated.` })
    } catch (error) {
      notifications.show({ color: 'red', title: 'Refresh failed', message: String(error) })
    }
  }

  const handleTest = async (server: McpServerSnapshot) => {
    try {
      const result = await testServer({ serverId: server.id })
      if (result.ok) {
        notifications.show({
          color: 'green',
          title: 'Connection OK',
          message: `Found ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'}.`,
        })
      } else {
        notifications.show({ color: 'red', title: 'Test failed', message: result.error || 'Unable to reach server.' })
      }
    } catch (error) {
      notifications.show({ color: 'red', title: 'Test failed', message: String(error) })
    }
  }

  const handleDelete = async (server: McpServerSnapshot) => {
    const confirmed = window.confirm(`Delete "${server.label}"? This cannot be undone.`)
    if (!confirmed) return
    try {
      await deleteServer(server.id)
      notifications.show({ color: 'green', title: 'Server removed', message: `${server.label} deleted.` })
    } catch (error) {
      notifications.show({ color: 'red', title: 'Delete failed', message: String(error) })
    }
  }

  const drawerSubmitting = editingServer ? !!mutatingIds[editingServer.id] : creating
  const drawerTesting = editingServer
    ? !!testingIds[editingServer.id]
    : !!testingIds['__draft__']

  return (
    <ScreenLoader
      hydration={useMcpHydration}
      onLoad={hydrateServers}
      skeleton={<ListSkeleton rows={4} />}
      minHeight="100%"
    >
      <Box style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
        <Group justify="space-between" align="flex-start" mb="lg">
          <Stack gap={4}>
            <Title order={2} c="white">
              MCP Servers
            </Title>
            <Text c="dimmed" size="sm">
              Register MCP endpoints so flows can call their tools.
            </Text>
          </Stack>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateDrawer}>
            Add server
          </Button>
        </Group>

        <Group gap="lg" mb="xl">
          <Paper withBorder p="md" radius="md" style={{ minWidth: 180 }}>
            <Text size="xs" c="dimmed">
              Enabled
            </Text>
            <Text size="xl" c="white" fw={600}>
              {summary.enabled}
            </Text>
          </Paper>
          <Paper withBorder p="md" radius="md" style={{ minWidth: 180 }}>
            <Text size="xs" c="dimmed">
              Connected
            </Text>
            <Text size="xl" c="white" fw={600}>
              {summary.connected}
            </Text>
          </Paper>
          <Paper withBorder p="md" radius="md" style={{ minWidth: 180 }}>
            <Text size="xs" c="dimmed">
              Total tools
            </Text>
            <Text size="xl" c="white" fw={600}>
              {summary.tools}
            </Text>
          </Paper>
        </Group>

        {servers.length === 0 && !loading ? (
          <Paper withBorder radius="md" p="xl" bg="rgba(255,255,255,0.02)">
            <Stack align="center" gap="sm">
              <IconPlugConnected size={48} color="var(--mantine-color-blue-4)" />
              <Text c="white" fw={500}>
                No MCP servers yet
              </Text>
              <Text c="dimmed" ta="center">
                Add a server to expose its tools to the Flow runtime.
              </Text>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateDrawer}>
                Add your first server
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Stack gap="md">
            {servers.map((server) => (
              <McpServerCard
                key={server.id}
                server={server}
                onToggle={handleToggle}
                onRefresh={handleRefresh}
                onTest={handleTest}
                onEdit={openEditDrawer}
                onDelete={handleDelete}
                mutating={!!mutatingIds[server.id]}
                testing={!!testingIds[server.id]}
              />
            ))}
          </Stack>
        )}
      </Box>

      <McpServerDrawer
        opened={drawerOpen}
        server={editingServer}
        submitting={drawerSubmitting}
        testing={drawerTesting}
        onClose={() => {
          setDrawerOpen(false)
          setEditingServer(null)
        }}
        onSubmit={async (payload, serverId) => {
          try {
            await handleSubmit(payload, serverId)
          } catch (error) {
            notifications.show({ color: 'red', title: 'Save failed', message: String(error) })
          }
        }}
        onTest={async (payload) => {
          try {
            const result = await testServer({ server: payload })
            return result
          } catch (error) {
            notifications.show({ color: 'red', title: 'Test failed', message: String(error) })
            throw error
          }
        }}
      />
    </ScreenLoader>
  )
}

