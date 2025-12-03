import type { FlowDefinition, NodeOutput } from '../types'
import type { NodeFunction } from '../types'
import { FlowScheduler } from '../scheduler'

const nodeFunctions: Record<string, NodeFunction> = {}

jest.mock('../nodes', () => ({
  getNodeFunction: (node: { nodeType?: string; type?: string; data?: { nodeType?: string } }) => {
    const nodeType = node.nodeType || node.type || node.data?.nodeType
    const fn = nodeFunctions[nodeType || '']
    if (!fn) {
      throw new Error(`Unknown test node type: ${nodeType}`)
    }
    return fn
  }
}))

const mockSessionService = {
  getCurrentIdFor: jest.fn().mockReturnValue('session'),
  updateContextFor: jest.fn(),
}

const mockFlowGraphService = {
  getNodes: jest.fn().mockReturnValue([]),
}

const mockFlowContextsService = {
  setContextsFor: jest.fn(),
  clearContextsFor: jest.fn(),
  getContextsFor: jest.fn().mockReturnValue({
    requestId: null,
    mainContext: null,
    isolatedContexts: {},
    updatedAt: 0,
  }),
}

jest.mock(
  '../../services/index.js',
  () => ({
    getSessionService: () => mockSessionService,
    getFlowGraphService: () => mockFlowGraphService,
    getFlowContextsService: () => mockFlowContextsService,
  }),
  { virtual: true }
)

function createScheduler(flowDef: FlowDefinition) {
  return new FlowScheduler(undefined, 'req', flowDef, {
    requestId: 'req',
    flowDef,
    sessionId: 'session',
    workspaceId: '/tmp/workspace',
    initialContext: {
      provider: 'openai',
      model: 'gpt-4o',
      messageHistory: [],
    }
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 25): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) {
      return
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout')
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

describe('FlowScheduler multi-context routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(nodeFunctions).forEach(key => delete nodeFunctions[key])
  })

  it('pushes the active context over context edges even when the node omits it from outputs', async () => {
    const flowDef: FlowDefinition = {
      nodes: [
        { id: 'producer', nodeType: 'producer', position: { x: 0, y: 0 }, config: {} },
        { id: 'consumer', nodeType: 'consumer', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: 'ctx-edge',
          source: 'producer',
          target: 'consumer',
          sourceHandle: 'context',
          targetHandle: 'context',
        }
      ]
    }

    const scheduler = createScheduler(flowDef)
    const mainBinding = (scheduler as any).mainBinding
    const captured: { context?: any } = {}

    nodeFunctions.producer = jest.fn(async () => {
      return {
        status: 'success',
        data: 'payload',
      } as unknown as NodeOutput
    })

    nodeFunctions.consumer = jest.fn(async (_flow, context) => {
      captured.context = context
      return {
        status: 'success',
        context,
      }
    })

    await (scheduler as any).executeNode('producer', { context: mainBinding.ref.current }, null)

    await waitFor(() => Boolean(captured.context))

    expect(nodeFunctions.consumer).toHaveBeenCalled()
    expect(captured.context).toBe(mainBinding.ref.current)
  })

  it('does not overwrite canonical context state when stale snapshots are pushed', () => {
    const flowDef: FlowDefinition = {
      nodes: [
        { id: 'defaultContextStart-1', nodeType: 'defaultContextStart', position: { x: 0, y: 0 }, config: {} }
      ],
      edges: []
    }

    nodeFunctions.defaultContextStart = jest.fn(async (_flow, context) => ({
      status: 'success',
      context,
    }))

    const scheduler = createScheduler(flowDef)
    const mainBinding = (scheduler as any).mainBinding

    const staleSnapshot = { ...mainBinding.ref.current, messageHistory: [] }
    mainBinding.manager.addMessage({ role: 'user', content: 'latest' })
    expect(mainBinding.ref.current.messageHistory).toHaveLength(1)

    const binding = (scheduler as any).resolveActiveBinding({ context: staleSnapshot })

    expect(binding).toBe(mainBinding)
    expect((scheduler as any).mainBinding.ref.current.messageHistory).toHaveLength(1)
  })

  it('bridges portal nodes so context edges continue to flow through loops', async () => {
    const flowDef: FlowDefinition = {
      nodes: [
        { id: 'producer', nodeType: 'producer', position: { x: 0, y: 0 }, config: {} },
        { id: 'portal-in', nodeType: 'portalInput', position: { x: 150, y: 0 }, config: { id: 'loop' } },
        { id: 'portal-out', nodeType: 'portalOutput', position: { x: 300, y: 0 }, config: { id: 'loop' } },
        { id: 'consumer', nodeType: 'consumer', position: { x: 450, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: 'producer-to-portal',
          source: 'producer',
          target: 'portal-in',
          sourceHandle: 'context',
          targetHandle: 'context',
        },
        {
          id: 'portal-to-consumer',
          source: 'portal-out',
          target: 'consumer',
          sourceHandle: 'context',
          targetHandle: 'context',
        },
      ],
    }

    const scheduler = createScheduler(flowDef)
    const mainBinding = (scheduler as any).mainBinding
    const captured: { context?: any } = {}

    nodeFunctions.producer = jest.fn(async () => ({
      status: 'success',
      data: 'payload',
    } as unknown as NodeOutput))

    nodeFunctions.portalInput = jest.fn(async (_flow, context) => ({
      status: 'success',
      context,
    }))

    nodeFunctions.portalOutput = jest.fn(async (_flow, context) => ({
      status: 'success',
      context,
    }))

    nodeFunctions.consumer = jest.fn(async (_flow, context) => {
      captured.context = context
      return {
        status: 'success',
        context,
      }
    })

    await (scheduler as any).executeNode('producer', { context: mainBinding.ref.current }, null)

    await waitFor(() => Boolean(captured.context))

    expect(nodeFunctions.consumer).toHaveBeenCalled()
    expect(captured.context).toBe(mainBinding.ref.current)
  })
})

