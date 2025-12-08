import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { McpService } from '../McpService'

const mockClientInstances: Array<ReturnType<typeof createMockClient>> = []
const mockHttpTransportCtor = jest.fn()

function createMockClient() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'ping',
          description: 'Ping tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    listResources: jest.fn().mockResolvedValue({
      resources: [
        {
          uri: 'resource://foo',
          name: 'Foo',
        },
      ],
    }),
    callTool: jest.fn().mockResolvedValue({ content: [] }),
    close: jest.fn().mockResolvedValue(undefined),
  }
}

jest.mock('@modelcontextprotocol/sdk/client', () => {
  const Client = jest.fn().mockImplementation(() => {
    const instance = createMockClient()
    mockClientInstances.push(instance)
    return instance
  })
  return { Client }
})

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  class MockStdioClientTransport {
    public onclose?: () => void
    public onerror?: (error: Error) => void
    constructor(public readonly params: any) {}
    get pid(): number {
      return 1234
    }
    async close(): Promise<void> {
      this.onclose?.()
    }
  }
  return {
    StdioClientTransport: MockStdioClientTransport,
    getDefaultEnvironment: () => ({}),
  }
})

jest.mock('@modelcontextprotocol/sdk/client/websocket.js', () => {
  class MockWebSocketClientTransport {
    public onclose?: () => void
    public onerror?: (error: Error) => void
    constructor(_url: URL) {}
    async close(): Promise<void> {
      this.onclose?.()
    }
  }
  return { WebSocketClientTransport: MockWebSocketClientTransport }
})

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  const createMockHttpTransport = () => ({
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    onmessage: undefined as ((message: any) => void) | undefined,
    close: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
  })

  const StreamableHTTPClientTransport = jest.fn().mockImplementation((...args: any[]) => {
    mockHttpTransportCtor(...args)
    return createMockHttpTransport()
  })

  return { StreamableHTTPClientTransport }
})

describe('McpService', () => {
  beforeEach(() => {
    mockClientInstances.length = 0
    mockHttpTransportCtor.mockClear()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('creates servers and lists snapshots', async () => {
    const service = new McpService({ autoStart: false })
    const created = await service.createServer({
      label: 'Local Server',
      transport: { type: 'stdio', command: 'node' },
    })

    expect(created).toMatchObject({
      label: 'Local Server',
      status: 'disconnected',
      tools: [],
    })

    const list = service.listServers()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('Local Server')
  })

  it('emits events when updating servers', async () => {
    const service = new McpService({ autoStart: false })
    const events: any[] = []
    service.on('mcp:servers:changed', (payload) => events.push(payload))

    const created = await service.createServer({
      label: 'Primary',
      transport: { type: 'stdio', command: 'node' },
    })

    await service.updateServer(created.id, { label: 'Updated primary' })

    expect(events.length).toBeGreaterThanOrEqual(2) // create + update
    const snapshot = service.getServer(created.id)
    expect(snapshot?.label).toBe('Updated primary')
  })

  it('tests server connections using ephemeral client', async () => {
    const service = new McpService({ autoStart: false })
    const result = await service.testServer({
      server: {
        label: 'Temp',
        transport: { type: 'stdio', command: 'node' },
      },
    })
 
    expect(result.ok).toBe(true)
    expect(result.tools).toHaveLength(1)
    expect(result.resources).toHaveLength(1)
  })

  it('supports HTTP transports via Streamable HTTP client', async () => {
    const service = new McpService({ autoStart: false })
    const created = await service.createServer({
      label: 'Remote HTTP',
      transport: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      },
    })
 
    expect(created.transport).toMatchObject({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    })
 
    const testResult = await service.testServer({ serverId: created.id })
    expect(testResult.ok).toBe(true)
 
    expect(mockHttpTransportCtor).toHaveBeenCalled()
    const [url, options] = mockHttpTransportCtor.mock.calls[0]
    expect(url).toBeInstanceOf(URL)
    expect((url as URL).toString()).toBe('https://example.com/mcp')
    expect(options).toEqual({ requestInit: { headers: { Authorization: 'Bearer token' } } })
  })

  it('emits tool registry updates when availability changes', async () => {
    const service = new McpService({ autoStart: false })
    const events: any[] = []
    service.on('mcp:tools:changed', (payload) => events.push(payload))

    const created = await service.createServer({
      label: 'Dynamic',
      transport: { type: 'stdio', command: 'node' },
    })

    expect(service.getAgentTools()).toHaveLength(0)

    await service.refreshServer(created.id)

    expect(events.length).toBeGreaterThan(0)
    const toolsAfterConnect = service.getAgentTools()
    expect(toolsAfterConnect.some((tool) => tool.name.startsWith('mcp.'))).toBe(true)

    await service.toggleServer(created.id, false)
    expect(events.length).toBeGreaterThan(1)
  })
})
