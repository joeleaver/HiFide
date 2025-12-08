import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { IconPlus, IconTrash, IconAlertCircle, IconCheck, IconPlugConnected } from '@tabler/icons-react'
import type { CreateMcpServerInput, McpServerSnapshot, McpTestResult } from '../../../shared/mcp'

interface KeyValueRow {
  id: string
  key: string
  value: string
}
type DrawerMode = 'json' | 'manual'

export interface McpServerDrawerProps {
  opened: boolean
  server?: McpServerSnapshot | null
  submitting: boolean
  testing: boolean
  onClose: () => void
  onSubmit: (input: CreateMcpServerInput, serverId?: string) => Promise<void>
  onTest: (input: CreateMcpServerInput) => Promise<McpTestResult>
}

interface FormErrors {
  label?: string
  command?: string
  url?: string
}

const makeRowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function buildRows(source?: Record<string, string>): KeyValueRow[] {
  const entries = Object.entries(source || {})
  if (entries.length === 0) {
    return [{ id: makeRowId(), key: '', value: '' }]
  }
  return entries.map(([key, value]) => ({ id: makeRowId(), key, value }))
}

export default function McpServerDrawer({
  opened,
  server,
  submitting,
  testing,
  onClose,
  onSubmit,
  onTest,
}: McpServerDrawerProps) {
  const [label, setLabel] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'websocket' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<string[]>([])
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([{ id: makeRowId(), key: '', value: '' }])
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>([{ id: makeRowId(), key: '', value: '' }])
  const [autoStart, setAutoStart] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [errors, setErrors] = useState<FormErrors>({})
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)
  const [mode, setMode] = useState<DrawerMode>('json')
  const [jsonSnippet, setJsonSnippet] = useState('')
  const [jsonHelper, setJsonHelper] = useState<string | null>(null)

  const resetForm = () => {
    setMode('json')
    setJsonSnippet('')
    setJsonHelper(null)
    setLabel('')
    setTransport('stdio')
    setCommand('')
    setArgs([])
    setCwd('')
    setUrl('')
    setEnvRows([{ id: makeRowId(), key: '', value: '' }])
    setHeaderRows([{ id: makeRowId(), key: '', value: '' }])
    setAutoStart(true)
    setEnabled(true)
    setErrors({})
    setTestResult(null)
  }

  const drawerTitle = server ? `Edit ${server.label}` : 'Add MCP server'

  useEffect(() => {
    if (!opened) {
      return
    }

    if (server) {
      setLabel(server.label)
      setTransport(server.transport.type)
      if (server.transport.type === 'stdio') {
        setCommand(server.transport.command)
        setArgs(Array.isArray(server.transport.args) ? server.transport.args : [])
        setCwd(server.transport.cwd ?? '')
        setUrl('')
      } else {
        setUrl(server.transport.url)
        setCommand('')
        setArgs([])
        setCwd('')
      }
      setEnvRows(buildRows(server.env || {}))
      const headerSource =
        server.transport.type === 'http' || server.transport.type === 'websocket'
          ? server.transport.headers || {}
          : undefined
      setHeaderRows(buildRows(headerSource))
      setAutoStart(server.autoStart)
      setEnabled(server.enabled)
      setMode('manual')
      setJsonSnippet(serializeSnapshotToSnippet(server))
      setJsonHelper(null)
    } else {
      resetForm()
    }
    setErrors({})
    setTestResult(null)
  }, [opened, server])

  const envEntries = useMemo(() => envRows, [envRows])
  const headerEntries = useMemo(() => headerRows, [headerRows])

  const { jsonPreview, jsonParseError } = useMemo(() => {
    if (mode !== 'json') {
      return { jsonPreview: null as CreateMcpServerInput | null, jsonParseError: null as string | null }
    }
    const trimmed = jsonSnippet.trim()
    if (!trimmed) {
      return { jsonPreview: null as CreateMcpServerInput | null, jsonParseError: null as string | null }
    }
    try {
      const parsed = parseSnippetInput(trimmed)
      return { jsonPreview: parsed, jsonParseError: null as string | null }
    } catch (error) {
      return {
        jsonPreview: null as CreateMcpServerInput | null,
        jsonParseError: error instanceof Error ? error.message : 'Unable to parse JSON snippet.',
      }
    }
  }, [jsonSnippet, mode])

  useEffect(() => {
    setJsonHelper(null)
  }, [jsonSnippet, mode])

  const jsonError = jsonParseError || jsonHelper

  const updateEnvRow = (id: string, field: 'key' | 'value', value: string) => {
    setEnvRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }
 
  const removeEnvRow = (id: string) => {
    setEnvRows((rows) => {
      if (rows.length === 1) {
        return [{ id: makeRowId(), key: '', value: '' }]
      }
      return rows.filter((row) => row.id !== id)
    })
  }
 
  const addEnvRow = () => {
    setEnvRows((rows) => [...rows, { id: makeRowId(), key: '', value: '' }])
  }
 
  const updateHeaderRow = (id: string, field: 'key' | 'value', value: string) => {
    setHeaderRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }
 
  const removeHeaderRow = (id: string) => {
    setHeaderRows((rows) => {
      if (rows.length === 1) {
        return [{ id: makeRowId(), key: '', value: '' }]
      }
      return rows.filter((row) => row.id !== id)
    })
  }
 
  const addHeaderRow = () => {
    setHeaderRows((rows) => [...rows, { id: makeRowId(), key: '', value: '' }])
  }

  const buildPayload = (): CreateMcpServerInput | null => {
    if (mode === 'json') {
      setErrors({})
      const trimmed = jsonSnippet.trim()
      if (!trimmed) {
        setJsonHelper('Paste an MCP JSON snippet to continue.')
        return null
      }

      if (jsonParseError) {
        setJsonHelper(null)
        return null
      }

      try {
        const parsed = parseSnippetInput(trimmed)
        setJsonHelper(null)
        return parsed
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to parse MCP JSON snippet.'
        setJsonHelper(message)
        return null
      }
    }

    setJsonHelper(null)

    const nextErrors: FormErrors = {}
    const nextLabel = label.trim()
    if (!nextLabel) {
      nextErrors.label = 'Label is required'
    }

    if (transport === 'stdio' && !command.trim()) {
      nextErrors.command = 'Command is required'
    }

    if ((transport === 'websocket' || transport === 'http') && !url.trim()) {
      nextErrors.url = transport === 'http' ? 'HTTP endpoint is required' : 'WebSocket URL is required'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return null
    }

    const cleanedArgs = args.map((arg) => arg.trim()).filter((arg) => arg.length > 0)
    const env: Record<string, string> = {}
    for (const row of envEntries) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (key && value) {
        env[key] = value
      }
    }

    const headers: Record<string, string> = {}
    for (const row of headerEntries) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (key && value) {
        headers[key] = value
      }
    }

    const cleanedHeaders = Object.keys(headers).length > 0 ? headers : undefined
    const nextUrl = url.trim()
 
    const payload: CreateMcpServerInput = {
      label: nextLabel,
      transport:
        transport === 'stdio'
          ? {
              type: 'stdio',
              command: command.trim(),
              args: cleanedArgs,
              cwd: cwd.trim() || undefined,
            }
          : transport === 'websocket'
            ? {
                type: 'websocket',
                url: nextUrl,
              }
            : {
                type: 'http',
                url: nextUrl,
                headers: cleanedHeaders,
              },
      env,
      autoStart,
      enabled,
    }

    return payload
  }

  const handleSubmit = async () => {
    const payload = buildPayload()
    if (!payload) return
    await onSubmit(payload, server?.id)
  }

  const handleTest = async () => {
    const payload = buildPayload()
    if (!payload) return
    const result = await onTest(payload)
    setTestResult(result)
  }

  return (
    <Drawer
      opened={opened}
      onClose={() => {
        onClose()
      }}
      title={drawerTitle}
      size="lg"
      position="right"
      overlayProps={{ opacity: 0.55, blur: 2 }}
    >
      <Stack gap="lg">
        <Stack gap={6}>
          <Text c="dimmed" size="sm">
            {server
              ? 'Update the MCP server via JSON import or manual edits.'
              : 'Paste an MCP JSON snippet (Claude Desktop, Continue, etc.) or switch to manual setup.'}
          </Text>
          <SegmentedControl
            fullWidth
            radius="md"
            size="sm"
            value={mode}
            onChange={(value) => setMode(value as DrawerMode)}
            data={[
              { value: 'json', label: 'JSON snippet' },
              { value: 'manual', label: 'Manual form' },
            ]}
          />
        </Stack>

        {mode === 'json' ? (
          <Stack gap="xs">
            <Textarea
              label="MCP JSON snippet"
              description="Paste the block from your existing MCP client configuration."
              minRows={10}
              autosize
              value={jsonSnippet}
              onChange={(event) => setJsonSnippet(event.currentTarget.value)}
              placeholder={`{
  "label": "filesystem",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "."]
  }
}`}
            />
            {jsonError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {jsonError}
              </Alert>
            )}
            {jsonPreview && !jsonError && (
              <Alert color="blue" icon={<IconPlugConnected size={16} />} variant="light">
                Detected “{jsonPreview.label}” · {describeImportedTransport(jsonPreview)}
              </Alert>
            )}
          </Stack>
        ) : (
          <>
            <TextInput
              label="Display label"
              placeholder="My local MCP server"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              error={errors.label}
              required
            />

            <Select
              label="Transport"
              data={[
                { value: 'stdio', label: 'Local process (stdio)' },
                { value: 'websocket', label: 'WebSocket endpoint' },
                { value: 'http', label: 'HTTP endpoint (SSE)' },
              ]}
              value={transport}
              onChange={(value) => {
                if (value === 'stdio' || value === 'websocket' || value === 'http') {
                  setTransport(value)
                }
              }}
            />

            {transport === 'stdio' ? (
              <Stack gap="sm">
                <TextInput
                  label="Command"
                  placeholder="node ./server.mjs"
                  value={command}
                  onChange={(event) => setCommand(event.currentTarget.value)}
                  error={errors.command}
                  required
                />
                <TagsInput
                  label="Arguments"
                  description="Optional command arguments"
                  placeholder="Add argument and press Enter"
                  value={args}
                  onChange={setArgs}
                />
                <TextInput
                  label="Working directory"
                  placeholder="/absolute/path"
                  value={cwd}
                  onChange={(event) => setCwd(event.currentTarget.value)}
                />
              </Stack>
            ) : transport === 'websocket' ? (
              <TextInput
                label="WebSocket URL"
                placeholder="wss://example.com/mcp"
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                error={errors.url}
                required
              />
            ) : (
              <TextInput
                label="HTTP endpoint"
                placeholder="https://example.com/mcp"
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                error={errors.url}
                required
              />
            )}

            {transport === 'stdio' && (
              <>
                <Divider label="Environment variables" labelPosition="center" />

                <Stack gap="xs">
                  {envEntries.map((row, index) => (
                    <Group key={row.id} align="flex-end" gap="xs">
                      <TextInput
                        label={index === 0 ? 'Key' : undefined}
                        placeholder="API_KEY"
                        value={row.key}
                        onChange={(event) => updateEnvRow(row.id, 'key', event.currentTarget.value)}
                        style={{ flex: 1 }}
                      />
                      <TextInput
                        label={index === 0 ? 'Value' : undefined}
                        placeholder="secret"
                        value={row.value}
                        onChange={(event) => updateEnvRow(row.id, 'value', event.currentTarget.value)}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon
                        variant="light"
                        aria-label="Remove variable"
                        onClick={() => removeEnvRow(row.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    variant="subtle"
                    leftSection={<IconPlus size={16} />}
                    size="xs"
                    onClick={addEnvRow}
                  >
                    Add variable
                  </Button>
                </Stack>
              </>
            )}

            {transport === 'http' && (
              <>
                <Divider label="HTTP headers" labelPosition="center" />

                <Stack gap="xs">
                  {headerEntries.map((row, index) => (
                    <Group key={row.id} align="flex-end" gap="xs">
                      <TextInput
                        label={index === 0 ? 'Header' : undefined}
                        placeholder="Authorization"
                        value={row.key}
                        onChange={(event) => updateHeaderRow(row.id, 'key', event.currentTarget.value)}
                        style={{ flex: 1 }}
                      />
                      <TextInput
                        label={index === 0 ? 'Value' : undefined}
                        placeholder="Bearer ..."
                        value={row.value}
                        onChange={(event) => updateHeaderRow(row.id, 'value', event.currentTarget.value)}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon
                        variant="light"
                        aria-label="Remove header"
                        onClick={() => removeHeaderRow(row.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    variant="subtle"
                    leftSection={<IconPlus size={16} />}
                    size="xs"
                    onClick={addHeaderRow}
                  >
                    Add header
                  </Button>
                </Stack>
              </>
            )}

            <Group align="flex-start">
              <Switch
                checked={autoStart}
                onChange={(event) => setAutoStart(event.currentTarget.checked)}
                label="Auto-start and reconnect"
              />
              <Switch
                checked={enabled}
                onChange={(event) => setEnabled(event.currentTarget.checked)}
                label="Enabled"
              />
            </Group>
          </>
        )}

        {testResult && (
          <Alert
            color={testResult.ok ? 'green' : 'red'}
            icon={testResult.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
            title={testResult.ok ? 'Connection looks good' : 'Test failed'}
          >
            {testResult.ok
              ? `Discovered ${testResult.tools.length} tool${testResult.tools.length === 1 ? '' : 's'} and ${testResult.resources.length} resource${testResult.resources.length === 1 ? '' : 's'}.`
              : testResult.error || 'The MCP server did not respond.'}
          </Alert>
        )}

        <Group justify="space-between">
          <Button
            variant="default"
            leftSection={<IconPlugConnected size={16} />}
            onClick={handleTest}
            loading={testing}
          >
            Test connection
          </Button>
          <Group>
            <Button variant="default" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={submitting}>
              {server ? 'Save changes' : 'Add server'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  )
}

function parseSnippetInput(snippet: string): CreateMcpServerInput {
  let data: unknown
  try {
    data = JSON.parse(snippet)
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`)
  }

  const server = extractServerConfig(data)
  if (!server) {
    throw new Error('Could not find an MCP server definition in the snippet.')
  }
  return server
}

function extractServerConfig(data: unknown, fallbackLabel?: string): CreateMcpServerInput | null {
  if (data == null) {
    return null
  }

  if (Array.isArray(data)) {
    for (const entry of data) {
      const candidate = extractServerConfig(entry, fallbackLabel)
      if (candidate) {
        return candidate
      }
    }
    return null
  }

  if (typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>

  if (record.mcpServers && typeof record.mcpServers === 'object') {
    const servers = record.mcpServers as Record<string, unknown>
    if (Array.isArray(servers)) {
      for (const entry of servers) {
        const candidate = extractServerConfig(entry, fallbackLabel)
        if (candidate) {
          return candidate
        }
      }
    } else {
      for (const [slug, value] of Object.entries(servers)) {
        const candidate = buildInputFromRaw(value, slug)
        if (candidate) {
          return candidate
        }
      }
    }
  }

  if (record.server && typeof record.server === 'object') {
    const candidate = buildInputFromRaw(record.server, fallbackLabel)
    if (candidate) {
      return candidate
    }
  }

  const direct = buildInputFromRaw(record, fallbackLabel)
  if (direct) {
    return direct
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      const nested = extractServerConfig(value, fallbackLabel)
      if (nested) {
        return nested
      }
    }
  }

  return null
}

function buildInputFromRaw(raw: unknown, fallbackLabel?: string): CreateMcpServerInput | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Record<string, unknown>
  const transportSource =
    (typeof candidate.transport === 'object' && candidate.transport !== null ? candidate.transport : undefined) ??
    (typeof candidate.app === 'object' && candidate.app !== null ? candidate.app : undefined) ??
    candidate
  const transport = deriveTransportFromRaw(transportSource)
  if (!transport) {
    return null
  }

  const label = pickLabel(candidate, fallbackLabel)
  if (!label) {
    return null
  }

  const envRecord = sanitizeStringRecord(candidate.env)

  const payload: CreateMcpServerInput = {
    label,
    transport,
    env: envRecord,
    autoStart: typeof candidate.autoStart === 'boolean' ? candidate.autoStart : true,
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : typeof candidate.disabled === 'boolean'
          ? !candidate.disabled
          : true,
  }

  return payload
}

function deriveTransportFromRaw(raw: unknown): CreateMcpServerInput['transport'] | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Record<string, unknown>
  const type =
    typeof candidate.type === 'string' && candidate.type.trim().length > 0
      ? candidate.type.trim().toLowerCase()
      : undefined
  const command = typeof candidate.command === 'string' ? candidate.command.trim() : undefined

  if ((type === 'stdio' || (!type && command)) && command) {
    const args = ensureStringArray(candidate.args)
    const cwdValue = typeof candidate.cwd === 'string' && candidate.cwd.trim().length > 0 ? candidate.cwd.trim() : undefined
    return {
      type: 'stdio',
      command,
      args: args.length > 0 ? args : undefined,
      cwd: cwdValue,
    }
  }

  const pickUrl = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
    }
    return undefined
  }

  const websocketUrl = pickUrl(candidate.websocketUrl, (candidate as any).webSocketUrl)
  const httpUrl = pickUrl(candidate.httpUrl, (candidate as any).httpEndpoint)
  const genericUrl = pickUrl(candidate.url, (candidate as any).endpoint, (candidate as any).address, (candidate as any).uri)
  const inferredKind = inferTransportFromUrl(genericUrl ?? websocketUrl ?? httpUrl)

  const httpTypeHints = new Set(['http', 'https', 'sse', 'http+sse', 'streamable-http'])
  if ((type && httpTypeHints.has(type)) || (!type && (inferredKind === 'http' || httpUrl))) {
    const url = httpUrl ?? genericUrl ?? websocketUrl
    if (!url) {
      return null
    }
    const headers = sanitizeStringRecord(candidate.headers || candidate.httpHeaders)
    return {
      type: 'http',
      url,
      headers,
    }
  }

  const websocketTypeHints = new Set(['websocket', 'ws', 'wss'])
  if ((type && websocketTypeHints.has(type)) || (!type && (inferredKind === 'websocket' || websocketUrl))) {
    const url = websocketUrl ?? genericUrl ?? httpUrl
    if (!url) {
      return null
    }
    const headers = sanitizeStringRecord(candidate.headers || (candidate as any).websocketHeaders)
    return {
      type: 'websocket',
      url,
      headers,
    }
  }

  return null
}

function inferTransportFromUrl(url?: string): 'http' | 'websocket' | undefined {
  if (!url) {
    return undefined
  }
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return 'http'
  }
  if (lower.startsWith('ws://') || lower.startsWith('wss://')) {
    return 'websocket'
  }
  return undefined
}

function ensureStringArray(value: unknown): string[] {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(' ')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  return []
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const [key, rawVal] of Object.entries(record)) {
    if (!key) continue
    if (rawVal == null) continue
    result[key] = String(rawVal)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function pickLabel(candidate: Record<string, unknown>, fallback?: string): string | null {
  const labelCandidates = [candidate.label, candidate.name, candidate.slug, fallback]
  for (const value of labelCandidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function serializeSnapshotToSnippet(server: McpServerSnapshot): string {
  const transport: CreateMcpServerInput['transport'] =
    server.transport.type === 'stdio'
      ? {
          type: 'stdio',
          command: server.transport.command,
          args:
            Array.isArray(server.transport.args) && server.transport.args.length > 0
              ? [...server.transport.args]
              : undefined,
          cwd: server.transport.cwd,
        }
      : server.transport.type === 'websocket'
        ? {
            type: 'websocket',
            url: server.transport.url,
            headers: server.transport.headers ? { ...server.transport.headers } : undefined,
          }
        : {
            type: 'http',
            url: server.transport.url,
            headers: server.transport.headers ? { ...server.transport.headers } : undefined,
          }

  const env = server.env && Object.keys(server.env).length > 0 ? { ...server.env } : undefined

  const payload: CreateMcpServerInput = {
    label: server.label,
    transport,
    env,
    autoStart: server.autoStart,
    enabled: server.enabled,
  }

  return JSON.stringify(payload, null, 2)
}

function describeImportedTransport(server: CreateMcpServerInput): string {
  if (server.transport.type === 'stdio') {
    const args = Array.isArray(server.transport.args) && server.transport.args.length > 0 ? ` ${server.transport.args.join(' ')}` : ''
    return `${server.transport.command}${args}`
  }
  return server.transport.url
}

