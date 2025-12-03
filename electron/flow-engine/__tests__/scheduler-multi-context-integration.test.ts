import type { FlowDefinition, NodeOutput } from '../types'
import type { NodeFunction } from '../types'
import type { MainFlowContext } from '../types'
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

const sessionUpdates: Array<{
  workspaceId: string
  sessionId: string
  messageHistory: any[]
  provider: string
  model: string
  systemInstructions?: string
}> = []

const publishedContexts: Array<{
  workspaceId: string
  requestId: string
  mainContext: MainFlowContext | null
  isolatedContexts: Record<string, MainFlowContext>
}> = []

const mockSessionService = {
  getCurrentIdFor: jest.fn().mockReturnValue('session'),
  updateContextFor: jest.fn((payload: any) => {
    sessionUpdates.push(payload)
  })
}

const mockFlowGraphService = {
  getNodes: jest.fn().mockReturnValue([]),
}

const mockFlowContextsService = {
  setContextsFor: jest.fn((payload: any) => {
    publishedContexts.push(payload)
  }),
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
      systemInstructions: 'stay-main'
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

describe('FlowScheduler isolated context integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    sessionUpdates.length = 0
    publishedContexts.length = 0
    Object.keys(nodeFunctions).forEach(key => delete nodeFunctions[key])
  })

  it('creates, routes, and releases isolated contexts while keeping the main context clean', async () => {
    const flowDef: FlowDefinition = {
      nodes: [
        { id: 'defaultContextStart-1', nodeType: 'defaultContextStart', position: { x: 0, y: 0 }, config: {} },
        { id: 'branch', nodeType: 'isolatedBranch', position: { x: 150, y: 0 }, config: { label: 'analysis' } },
        { id: 'worker', nodeType: 'isolatedWorker', position: { x: 300, y: 0 }, config: {} },
        { id: 'release', nodeType: 'releaseIsolated', position: { x: 450, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: 'start-to-branch',
          source: 'defaultContextStart-1',
          target: 'branch',
          sourceHandle: 'context',
          targetHandle: 'context',
        },
        {
          id: 'branch-to-worker',
          source: 'branch',
          target: 'worker',
          sourceHandle: 'context',
          targetHandle: 'context',
        },
        {
          id: 'worker-to-release',
          source: 'worker',
          target: 'release',
          sourceHandle: 'context',
          targetHandle: 'context',
        }
      ]
    }

    let isolatedContextId: string | undefined

    nodeFunctions.defaultContextStart = jest.fn(async (flow): Promise<NodeOutput> => {
      flow.context.addMessage({ role: 'user', content: 'main-start' })
      return {
        status: 'success',
        context: flow.context.get(),
      }
    }) as unknown as NodeFunction

    nodeFunctions.isolatedBranch = jest.fn(async (flow, context, _data, _inputs, config): Promise<NodeOutput> => {
      expect(context.contextType).toBe('main')
      const isolated = flow.contexts.createIsolated({
        label: config?.label,
        inheritHistory: false,
        initialMessages: [{ role: 'system', content: 'branch-root' }],
      })
      isolatedContextId = isolated.contextId
      return {
        status: 'success',
        context: isolated,
      }
    }) as unknown as NodeFunction

    nodeFunctions.isolatedWorker = jest.fn(async (flow, context): Promise<NodeOutput> => {
      expect(context.contextType).toBe('isolated')
      expect(context.contextId).toBe(isolatedContextId)
      flow.context.addMessage({ role: 'user', content: 'isolated-step' })
      return {
        status: 'success',
        data: 'branch-complete',
        context: flow.context.get(),
      }
    }) as unknown as NodeFunction

    nodeFunctions.releaseIsolated = jest.fn(async (flow, context): Promise<NodeOutput> => {
      expect(context.contextId).toBe(isolatedContextId)
      const released = flow.contexts.release(context.contextId)
      expect(released).toBe(true)
      const parent = context.parentContextId ? flow.contexts.get(context.parentContextId) : undefined
      const fallback = flow.contexts.list().find((ctx) => ctx.contextType === 'main')
      const nextContext = parent || fallback
      if (!nextContext) {
        throw new Error('Missing parent context after release')
      }
      return {
        status: 'success',
        data: { released },
        context: nextContext,
      }
    }) as unknown as NodeFunction

    const scheduler = createScheduler(flowDef)
    const mainBinding = (scheduler as any).mainBinding

    await (scheduler as any).executeNode('defaultContextStart-1', { context: mainBinding.ref.current }, null)

    await waitFor(() => (nodeFunctions.releaseIsolated as jest.Mock).mock.calls.length === 1)

    await waitFor(() => publishedContexts.some((state) => Object.keys(state.isolatedContexts || {}).length === 1))
    await waitFor(() => {
      if (!publishedContexts.length) return false
      const last = publishedContexts[publishedContexts.length - 1]
      return Object.keys(last.isolatedContexts || {}).length === 0
    })

    expect(isolatedContextId).toBeDefined()
    expect(nodeFunctions.isolatedWorker).toHaveBeenCalledTimes(1)
    expect(nodeFunctions.releaseIsolated).toHaveBeenCalledTimes(1)

    const isolatedStateHistory = publishedContexts.filter((state) =>
      state.isolatedContexts && isolatedContextId && state.isolatedContexts[isolatedContextId]
    )
    expect(isolatedStateHistory.length).toBeGreaterThan(0)
    const isolatedState = isolatedStateHistory[isolatedStateHistory.length - 1]

    const isolatedHistory = isolatedState.isolatedContexts[isolatedContextId!].messageHistory
    expect(isolatedHistory.map((msg) => msg.content)).toEqual(['branch-root', 'isolated-step'])

    const finalState = publishedContexts[publishedContexts.length - 1]
    expect(Object.keys(finalState.isolatedContexts)).toHaveLength(0)
    expect(finalState.mainContext?.messageHistory.map((msg) => msg.content)).toEqual(['main-start'])

    await waitFor(() => sessionUpdates.length >= 4)
    const lastSessionUpdate = sessionUpdates[sessionUpdates.length - 1]
    expect(lastSessionUpdate.messageHistory.map((msg: any) => msg.content)).toEqual(['main-start'])
  })
})

