export type McpTransportConfig =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      cwd?: string
    }
  | {
      type: 'websocket'
      url: string
      headers?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
      headers?: Record<string, string>
    }

export interface McpServerConfig {
  id: string
  slug: string
  label: string
  transport: McpTransportConfig
  env: Record<string, string>
  autoStart: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  workspaceId?: string | null
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown> | null
  outputSchema?: Record<string, unknown> | null
  annotations?: Record<string, unknown> | null
  execution?: {
    taskSupport?: 'optional' | 'required' | 'forbidden'
  } | null
}

export interface McpResourceSummary {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpRuntimeState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  lastError?: string | null
  lastSeen?: number | null
  tools: McpToolDefinition[]
  resources: McpResourceSummary[]
  pid?: number | null
}

export type McpServerSnapshot = McpServerConfig & McpRuntimeState

export interface CreateMcpServerInput {
  id?: string
  label: string
  transport: McpTransportConfig
  env?: Record<string, string | undefined | null>
  autoStart?: boolean
  enabled?: boolean
}

export type UpdateMcpServerInput = Partial<Omit<CreateMcpServerInput, 'id'>>

export interface McpTestResult {
  ok: boolean
  error?: string
  tools: McpToolDefinition[]
  resources: McpResourceSummary[]
}

