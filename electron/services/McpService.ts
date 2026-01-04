import { randomUUID } from 'node:crypto'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import packageJson from '../../package.json'
import type { AgentTool } from '../providers/provider'
import { Service } from './base/Service.js'
import { expandPathPlaceholders } from './utils/pathExpansion'
import type {
  CreateMcpServerInput,
  McpResourceSummary,
  McpRuntimeState,
  McpServerConfig,
  McpServerSnapshot,
  McpTestResult,
  McpToolDefinition,
  McpTransportConfig,
  UpdateMcpServerInput,
} from '../../shared/mcp.js'
export type {
  CreateMcpServerInput,
  McpResourceSummary,
  McpRuntimeState,
  McpServerConfig,
  McpServerSnapshot,
  McpTestResult,
  McpToolDefinition,
  McpTransportConfig,
  UpdateMcpServerInput,
} from '../../shared/mcp.js'

const CLIENT_INFO = {
  name: 'HiFide MCP Client',
  version: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0',
}

const PERSIST_KEY = 'mcp'
const DEFAULT_RECONNECT_DELAY_MS = 2000
const TOOL_NAME_PREFIX = 'mcp'

interface McpServiceState {
  configs: Record<string, McpServerConfig>
  runtime: Record<string, McpRuntimeState>
}


interface McpConnection {
  client: Client
  transport: Transport
  status: 'connecting' | 'connected'
  closing?: boolean
}

interface McpServiceOptions {
  autoStart?: boolean
}

export class McpService extends Service<McpServiceState> {
  private readonly connections = new Map<string, McpConnection>()
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>()
  private readonly connectingPromises = new Map<string, Promise<McpConnection | null>>()
  private readonly autoStartEnabled: boolean
  private toolsFingerprint: string | null = null
  private toolsVersion = 0

  constructor(options?: McpServiceOptions) {
    super(
      {
        configs: {},
        runtime: {},
      },
      PERSIST_KEY
    )

    this.sanitizeLegacyWorkspaceScopes()

    this.autoStartEnabled = options?.autoStart !== false
    if (this.autoStartEnabled) {
      queueMicrotask(() => {
        try {
          const configs = Object.values(this.state.configs)
          for (const cfg of configs) {
            if (cfg.enabled && cfg.autoStart) {
              void this.ensureConnection(cfg.id).catch((error) => {
                console.error('[mcp] Failed to auto-start server', cfg.id, error)
              })
            }
          }
        } catch (error) {
          console.error('[mcp] Auto-start bootstrap failed', error)
        }
      })
    }
  }

  protected override onStateChange(updates: Partial<McpServiceState>, _prevState: McpServiceState): void {
    const fields: (keyof McpServiceState)[] = []
    if (updates.configs !== undefined) fields.push('configs')
    if (updates.runtime !== undefined) fields.push('runtime')

    if (fields.length > 0) {
      this.persistFields(fields)
      this.emitServersChanged()
    }
  }

  listServers(_options?: { workspaceId?: string | null }): McpServerSnapshot[] {
    return Object.values(this.state.configs)
      .map((config) => this.buildSnapshot(config))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  getServer(serverId: string, _options?: { workspaceId?: string | null }): McpServerSnapshot | null {
    const config = this.state.configs[serverId]
    if (!config) return null

    return this.buildSnapshot(config)
  }

  async createServer(input: CreateMcpServerInput, _options?: { workspaceId?: string | null }): Promise<McpServerSnapshot> {
    const label = normalizeLabel(input.label)
    if (!label) {
      throw new Error('Server label is required')
    }


    const transport = this.normalizeTransport(input.transport)
    const env = normalizeEnv(input.env)
    const now = Date.now()
    const id = input.id && input.id.trim() ? input.id.trim() : `mcp-${randomUUID()}`
    const slug = createServerSlug(label, id)

    const config: McpServerConfig = {
      id,
      slug,
      label,
      transport,
      env,
      autoStart: input.autoStart ?? false,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      workspaceId: null,
    }

    this.setState({ configs: { ...this.state.configs, [config.id]: config } })
    this.ensureRuntimeEntry(config.id)

    if (config.enabled && config.autoStart && this.autoStartEnabled) {
      void this.ensureConnection(config.id).catch((error) => {
        console.error('[mcp] Auto-start connect failed', config.id, error)
      })
    }

    return this.buildSnapshot(config)
  }

  async updateServer(
    serverId: string,
    patch: UpdateMcpServerInput,
    _options?: { workspaceId?: string | null }
  ): Promise<McpServerSnapshot> {
    const existing = this.requireServer(serverId)

    const updatedTransport = patch.transport ? this.normalizeTransport(patch.transport) : existing.transport
    const updatedEnv = patch.env ? normalizeEnv(patch.env) : existing.env
    const label = patch.label !== undefined ? normalizeLabel(patch.label) : existing.label
    if (!label) {
      throw new Error('Server label is required')
    }

    const autoStart = patch.autoStart ?? existing.autoStart
    const enabled = patch.enabled ?? existing.enabled

    const config: McpServerConfig = {
      ...existing,
      label,
      transport: updatedTransport,
      env: updatedEnv,
      autoStart,
      enabled,
      updatedAt: Date.now(),
      workspaceId: null,
    }

    this.setState({ configs: { ...this.state.configs, [serverId]: config } })

    const requiresRestart =
      hasTransportChanged(existing.transport, updatedTransport) ||
      JSON.stringify(existing.env) !== JSON.stringify(updatedEnv)

    if (!enabled) {
      await this.disconnectServer(serverId, { suppressReconnect: true })
    } else if (requiresRestart && autoStart && this.autoStartEnabled) {
      await this.disconnectServer(serverId, { suppressReconnect: true })
      void this.ensureConnection(serverId).catch((error) => {
        console.error('[mcp] Failed to restart server', serverId, error)
      })
    }

    if (enabled && autoStart && this.autoStartEnabled) {
      void this.ensureConnection(serverId).catch((error) => {
        console.error('[mcp] Failed to ensure server connection', serverId, error)
      })
    }

    return this.buildSnapshot(config)
  }

  async deleteServer(serverId: string, _options?: { workspaceId?: string | null }): Promise<boolean> {
    if (!this.state.configs[serverId]) return false
    this.requireServer(serverId)

    const configs = { ...this.state.configs }
    delete configs[serverId]
    this.setState({ configs })

    await this.disconnectServer(serverId, { suppressReconnect: true })

    const runtime = { ...this.state.runtime }
    delete runtime[serverId]
    this.setState({ runtime })

    return true
  }

  async refreshServer(serverId: string, _options?: { workspaceId?: string | null }): Promise<McpServerSnapshot> {
    const config = this.requireServer(serverId)
    if (!config.enabled) throw new Error('Server is disabled')

    await this.ensureConnection(serverId, { refreshMetadata: true })
    return this.buildSnapshot(this.state.configs[serverId])
  }

  async toggleServer(serverId: string, enabled: boolean, options?: { workspaceId?: string | null }): Promise<McpServerSnapshot> {
    return this.updateServer(serverId, { enabled }, options)
  }

  async testServer(
    input: { server?: CreateMcpServerInput; serverId?: string },
    _options?: { workspaceId?: string | null }
  ): Promise<McpTestResult> {
    const config = input.serverId ? this.requireServer(input.serverId) : undefined

    if (!config && !input.server) {
      throw new Error('Either serverId or server configuration is required')
    }

    const normalizedTransport = config
      ? config.transport
      : this.normalizeTransport((input.server as CreateMcpServerInput).transport)
    const env = config ? config.env : normalizeEnv(input.server?.env)

    try {
      const session = await this.createEphemeralClient(normalizedTransport, env)
      const metadata = await this.loadMetadata(session.client)
      await session.client.close().catch(() => {})
      await session.transport.close().catch(() => {})
      return { ok: true, tools: metadata.tools, resources: metadata.resources }
    } catch (error) {
      return { ok: false, error: stringifyError(error), tools: [], resources: [] }
    }
  }

  async invokeTool(serverId: string, toolName: string, args: unknown, _meta?: { requestId?: string }): Promise<unknown> {
    const connection = await this.ensureConnection(serverId)
    if (!connection) {
      throw new Error(`Server not connected: ${serverId}`)
    }

    const payload: Record<string, unknown> =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : ({} as Record<string, unknown>)
    const result = await connection.client.callTool({ name: toolName, arguments: payload })

    this.updateRuntimeState(serverId, { lastSeen: Date.now() })
    return result
  }

  getAgentTools(_options?: { workspaceId?: string | null }): AgentTool[] {
    const snapshots = this.listServers()
    const tools: AgentTool[] = []

    for (const server of snapshots) {
      if (!server.enabled) continue
      const serverTools = Array.isArray(server.tools) ? server.tools : []
      if (serverTools.length === 0) continue
      for (const tool of serverTools) {
        tools.push({
          name: buildMcpToolName(server.slug, tool.name),
          description: tool.description ?? `${tool.name} (MCP via ${server.label})`,
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
          run: async (input, meta) => this.invokeTool(server.id, tool.name, input, meta),
          toModelResult: (raw: unknown) => ({ minimal: raw }),
        })
      }
    }

    return tools
  }

  private async ensureConnection(
    serverId: string,
    options?: { refreshMetadata?: boolean }
  ): Promise<McpConnection | null> {
    const config = this.state.configs[serverId]
    if (!config || !config.enabled) return null

    const existing = this.connections.get(serverId)
    if (existing) {
      if (options?.refreshMetadata && existing.status === 'connected') {
        await this.refreshMetadata(serverId, existing.client)
      }
      return existing
    }

    if (this.connectingPromises.has(serverId)) {
      return this.connectingPromises.get(serverId) ?? null
    }

    const promise = this.connectServer(serverId)
    this.connectingPromises.set(serverId, promise)

    try {
      return await promise
    } finally {
      this.connectingPromises.delete(serverId)
    }
  }

  private async connectServer(serverId: string): Promise<McpConnection | null> {
    const config = this.state.configs[serverId]
    if (!config || !config.enabled) return null

    this.ensureRuntimeEntry(serverId)
    this.updateRuntimeState(serverId, { status: 'connecting', lastError: null })

    const client = this.createClient()
    const transport = this.createTransport(config.transport, config.env)

    const connection: McpConnection = { client, transport, status: 'connecting' }
    this.connections.set(serverId, connection)

    transport.onclose = () => this.handleTransportClosed(serverId, connection)
    transport.onerror = (error: Error) => this.handleTransportError(serverId, error)

    try {
      await client.connect(transport)
      connection.status = 'connected'
      const metadata = await this.loadMetadata(client)
      this.updateRuntimeState(serverId, {
        status: 'connected',
        lastError: null,
        lastSeen: Date.now(),
        tools: metadata.tools,
        resources: metadata.resources,
        pid: extractPid(transport),
      })
      return connection
    } catch (error) {
      this.connections.delete(serverId)
      await transport.close().catch(() => {})
      this.handleConnectionError(serverId, error)
      throw error
    }
  }

  private async disconnectServer(serverId: string, options?: { suppressReconnect?: boolean }): Promise<void> {
    const connection = this.connections.get(serverId)
    if (!connection) {
      this.clearReconnectTimer(serverId)
      this.updateRuntimeState(serverId, { status: 'disconnected' })
      return
    }

    connection.closing = true
    this.connections.delete(serverId)
    this.clearReconnectTimer(serverId)

    try {
      await connection.client.close().catch(() => {})
    } catch {}
    try {
      await connection.transport.close()
    } catch {}

    this.updateRuntimeState(serverId, { status: 'disconnected' })

    if (!options?.suppressReconnect) {
      this.scheduleReconnect(serverId)
    }
  }

  private createClient(): Client {
    return new Client(CLIENT_INFO)
  }

  private createTransport(transport: McpTransportConfig, env: Record<string, string>): Transport {
    if (transport.type === 'stdio') {
      return new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        cwd: transport.cwd,
        env: {
          ...getDefaultEnvironment(),
          ...env,
        },
        stderr: 'pipe',
      })
    }

    if (transport.type === 'websocket') {
      return new WebSocketClientTransport(new URL(transport.url))
    }

    const httpOptions = transport.headers && Object.keys(transport.headers).length > 0
      ? { requestInit: { headers: transport.headers } }
      : undefined
    return new StreamableHTTPClientTransport(new URL(transport.url), httpOptions)
  }

  private async createEphemeralClient(transport: McpTransportConfig, env: Record<string, string>) {
    const client = this.createClient()
    const instance = this.createTransport(transport, env)
    await client.connect(instance)
    return { client, transport: instance }
  }

  private async loadMetadata(client: Client): Promise<{ tools: McpToolDefinition[]; resources: McpResourceSummary[] }> {
    const tools = await this.collectTools(client)
    const resources = await this.collectResources(client)
    return { tools, resources }
  }

  private async refreshMetadata(serverId: string, client: Client): Promise<void> {
    const metadata = await this.loadMetadata(client)
    this.updateRuntimeState(serverId, {
      tools: metadata.tools,
      resources: metadata.resources,
      lastSeen: Date.now(),
    })
  }

  private async collectTools(client: Client): Promise<McpToolDefinition[]> {
    const results: McpToolDefinition[] = []
    let cursor: string | undefined

    try {
      do {
        const response = await client.listTools(cursor ? { cursor } : undefined)
        const list = Array.isArray(response.tools) ? response.tools : []
        for (const tool of list) {
          results.push({
            name: String(tool.name),
            description: tool.description,
            inputSchema: cloneIfObject(tool.inputSchema),
            outputSchema: cloneIfObject(tool.outputSchema),
            annotations: cloneIfObject(tool.annotations),
            execution: tool.execution ? { taskSupport: tool.execution.taskSupport } : null,
          })
        }
        cursor = response.nextCursor || undefined
      } while (cursor)
    } catch (error) {
      if (isMethodNotFoundError(error)) {
        console.log('[mcp] Server does not support listing tools')
      } else {
        console.warn('[mcp] Failed to list tools', stringifyError(error))
      }
    }

    return results
  }

  private async collectResources(client: Client): Promise<McpResourceSummary[]> {
    const results: McpResourceSummary[] = []
    let cursor: string | undefined

    try {
      do {
        const response = await client.listResources(cursor ? { cursor } : undefined)
        const list = Array.isArray(response.resources) ? response.resources : []
        for (const resource of list) {
          results.push({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })
        }
        cursor = response.nextCursor || undefined
      } while (cursor)
    } catch (error) {
      if (isMethodNotFoundError(error)) {
        console.log('[mcp] Server does not support listing resources')
      } else {
        console.warn('[mcp] Failed to list resources', stringifyError(error))
      }
    }

    return results
  }

  private handleTransportClosed(serverId: string, connection: McpConnection): void {
    if (connection.closing) return
    this.connections.delete(serverId)
    this.updateRuntimeState(serverId, { status: 'disconnected' })
    this.scheduleReconnect(serverId)
  }

  private handleTransportError(serverId: string, error: Error): void {
    console.error('[mcp] transport error', serverId, error)
    this.updateRuntimeState(serverId, { status: 'error', lastError: stringifyError(error) })
    this.scheduleReconnect(serverId)
  }

  private handleConnectionError(serverId: string, error: unknown): void {
    console.error('[mcp] connection failed', serverId, error)
    this.updateRuntimeState(serverId, { status: 'error', lastError: stringifyError(error) })
    this.scheduleReconnect(serverId)
  }

  private scheduleReconnect(serverId: string): void {
    const config = this.state.configs[serverId]
    if (!config || !config.enabled || !config.autoStart || !this.autoStartEnabled) {
      return
    }

    if (this.reconnectTimers.has(serverId)) return

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId)
      void this.ensureConnection(serverId).catch((error) => {
        console.error('[mcp] reconnect attempt failed', serverId, error)
        this.scheduleReconnect(serverId)
      })
    }, DEFAULT_RECONNECT_DELAY_MS)

    if (typeof timer.unref === 'function') timer.unref()
    this.reconnectTimers.set(serverId, timer)
  }

  private clearReconnectTimer(serverId: string): void {
    const timer = this.reconnectTimers.get(serverId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(serverId)
    }
  }

  private ensureRuntimeEntry(serverId: string): void {
    if (!this.state.runtime[serverId]) {
      const runtime: McpRuntimeState = {
        status: 'disconnected',
        lastError: null,
        lastSeen: null,
        tools: [],
        resources: [],
        pid: null,
      }
      this.setState({ runtime: { ...this.state.runtime, [serverId]: runtime } })
    }
  }

  private updateRuntimeState(serverId: string, patch: Partial<McpRuntimeState>): void {
    const current = this.state.runtime[serverId] ?? {
      status: 'disconnected',
      lastError: null,
      lastSeen: null,
      tools: [],
      resources: [],
      pid: null,
    }
    const runtime = { ...this.state.runtime, [serverId]: { ...current, ...patch } }
    this.setState({ runtime })
  }

  private buildSnapshot(config: McpServerConfig): McpServerSnapshot {
    const runtime = this.state.runtime[config.id] ?? {
      status: 'disconnected',
      lastError: null,
      lastSeen: null,
      tools: [],
      resources: [],
      pid: null,
    }
    return { ...config, workspaceId: null, ...runtime }
  }

  private normalizeTransport(transport: McpTransportConfig): McpTransportConfig {
    if (!transport) throw new Error('Transport configuration is required')
    if (transport.type === 'stdio') {
      const rawCommand = transport.command?.trim()
      if (!rawCommand) throw new Error('Stdio transport requires a command')
      const command = expandPathPlaceholders(rawCommand)
      const args = Array.isArray(transport.args)
        ? transport.args
            .map((value) => String(value).trim())
            .filter((value) => value.length > 0)
        : undefined
      const cwdInput = transport.cwd?.trim()
      const cwd = cwdInput ? expandPathPlaceholders(cwdInput) : undefined
      return { type: 'stdio', command, args, cwd }
    }

    if (transport.type === 'websocket') {
      try {
        const url = new URL(transport.url)
        const headers = normalizeHeaders(transport.headers)
        return { type: 'websocket', url: url.toString(), headers }
      } catch {
        throw new Error('WebSocket transport requires a valid URL')
      }
    }

    if (transport.type === 'http') {
      try {
        const url = new URL(transport.url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('HTTP transport requires an http(s) URL')
        }
        const headers = normalizeHeaders(transport.headers)
        return { type: 'http', url: url.toString(), headers }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'HTTP transport requires a valid URL'
        throw new Error(message)
      }
    }
 
    throw new Error('Unsupported transport type')
  }


  private emitServersChanged(): void {
    try {
      const servers = this.listServers()
      this.emit('mcp:servers:changed', {
        workspaceId: null,
        servers,
      })
      this.maybeEmitToolsChanged(servers)
    } catch (error) {
      console.error('[mcp] Failed to emit servers changed event', error)
    }
  }

  private maybeEmitToolsChanged(snapshots?: McpServerSnapshot[]): void {
    try {
      const servers = snapshots ?? this.listServers()
      const available = servers
        .filter((server) => server.enabled && Array.isArray(server.tools) && server.tools.length > 0)
        .map((server) => ({
          id: server.id,
          slug: server.slug,
          label: server.label,
          tools: server.tools.map((tool) => ({
            name: tool.name,
            description: tool.description || null,
            inputSchema: tool.inputSchema || null,
          })),
        }))

      const fingerprint = JSON.stringify(available)
      if (fingerprint === this.toolsFingerprint) {
        return
      }

      this.toolsFingerprint = fingerprint
      this.toolsVersion += 1

      const summary = available.map((server) => ({
        id: server.id,
        slug: server.slug,
        label: server.label,
        toolCount: server.tools.length,
      }))

      this.emit('mcp:tools:changed', {
        workspaceId: null,
        version: this.toolsVersion,
        servers: summary,
      })
    } catch (error) {
      console.error('[mcp] Failed to emit tools changed event', error)
    }
  }

  private sanitizeLegacyWorkspaceScopes(): void {
    const entries = Object.entries(this.state.configs)
    if (entries.length === 0) return

    let mutated = false
    const configs: Record<string, McpServerConfig> = {}
    for (const [id, config] of entries) {
      if (config.workspaceId) {
        mutated = true
        configs[id] = { ...config, workspaceId: null }
      } else {
        configs[id] = config
      }
    }

    if (mutated) {
      this.setState({ configs })
    }
  }

  private requireServer(serverId: string): McpServerConfig {
    const config = this.state.configs[serverId]
    if (!config) {
      throw new Error(`Server not found: ${serverId}`)
    }
    return config
  }
}


function normalizeLabel(label: string | undefined): string {
  return (label ?? '').trim()
}

function normalizeEnv(env?: Record<string, string | undefined | null>): Record<string, string> {
  if (!env) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key?.trim()) continue
    if (value === undefined || value === null) continue
    result[key.trim()] = String(value)
  }
  return result
}
 
 function normalizeHeaders(headers?: Record<string, string | undefined | null>): Record<string, string> | undefined {
   if (!headers) return undefined
   const result: Record<string, string> = {}
   for (const [key, value] of Object.entries(headers)) {
     if (!key?.trim()) continue
     if (value === undefined || value === null) continue
     result[key.trim()] = String(value)
   }
   return Object.keys(result).length > 0 ? result : undefined
 }
 
 function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

function cloneIfObject<T>(value: T): T | null {
  if (!value || typeof value !== 'object') return value ?? null
  return structuredClone(value)
}

function createServerSlug(label: string, id: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = id.slice(-6)
  return `${base || 'mcp'}-${suffix}`
}

export function buildMcpToolName(slug: string, toolName: string): string {
  const sanitized = toolName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\./g, '_')
  return `${TOOL_NAME_PREFIX}_${slug}_${sanitized}`
}

function extractPid(transport: Transport): number | null {
  if (typeof (transport as any).pid === 'number') {
    return (transport as any).pid
  }
  if (typeof (transport as any).pid === 'function') {
    try {
      const value = (transport as any).pid()
      return typeof value === 'number' ? value : null
    } catch {
      return null
    }
  }
  return null
}

function hasTransportChanged(a: McpTransportConfig, b: McpTransportConfig): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

function isMethodNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in (error as any)) {
    return (error as any).code === -32601
  }
  const message = String(error).toLowerCase()
  return message.includes('method not found') || message.includes('-32601')
}
