/**
 * Test helper utilities for creating test contexts, configs, and mocks
 */

import crypto from 'node:crypto'
import type { ExecutionContext, MainFlowContext, NodeInputs } from '../../flow-engine/types'
import type { FlowAPI, Badge, UsageReport, CreateIsolatedContextOptions } from '../../flow-engine/flow-api'
import { createContextManager, type ContextManager } from '../../flow-engine/contextManager'
import type { ProviderAdapter, AgentTool } from '../../providers/provider'
import { withFixture, getTestMode } from './fixtures'

/**
 * Create a test execution context with sensible defaults
 */
export function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    systemInstructions: 'You are a helpful assistant.',
    messageHistory: [],
    currentOutput: '',
    sessionId: 'test-session-' + Date.now(),
    ...overrides
  }
}

/**
 * Create a test node config
 */
export function createTestConfig(overrides?: Record<string, any>): Record<string, any> {
  return {
    _nodeId: 'test-node',
    ...overrides
  }
}

/**
 * Create a simple test tool
 */
export function createTestTool(name: string = 'test_tool'): AgentTool {
  return {
    name,
    description: `A test tool named ${name}`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Test input' }
      },
      required: ['input']
    },
    run: async (input: any) => {
      return { result: `Tool ${name} executed with: ${JSON.stringify(input)}` }
    }
  }
}

/**
 * Get API key for testing
 * Reads from environment variable or throws helpful error
 */
export function getTestApiKey(provider: 'anthropic' | 'openai' | 'gemini' | 'fireworks'): string {
  const envVars: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    fireworks: 'FIREWORKS_API_KEY'
  }

  const envVar = envVars[provider]
  const apiKey = process.env[envVar]

  if (!apiKey && getTestMode() !== 'replay') {
    throw new Error(
      `Missing API key for ${provider}.\n` +
      `Set ${envVar} environment variable or run tests in replay mode (TEST_MODE=replay).`
    )
  }

  return apiKey || 'mock-api-key-for-replay'
}

/**
 * Create a mock provider adapter for testing
 * Useful for testing nodes without making real API calls
 */
export function createMockProvider(
  responses: string[] = ['Mock response']
): ProviderAdapter {
  let responseIndex = 0
  
  return {
    id: 'mock',

    async agentStream({ onChunk, onDone, onError, onTokenUsage, tools }) {
      try {
        const response = responses[responseIndex % responses.length]
        responseIndex++

        // Simulate streaming by chunking the response
        const chunkSize = 10
        for (let i = 0; i < response.length; i += chunkSize) {
          const chunk = response.slice(i, i + chunkSize)
          onChunk(chunk)
          await new Promise(resolve => setTimeout(resolve, 10))
        }

        // Simulate token usage
        if (onTokenUsage) {
          onTokenUsage({
            inputTokens: 10,
            outputTokens: response.length / 4,
            totalTokens: 10 + response.length / 4
          })
        }

        onDone()
      } catch (e: any) {
        onError(e.message)
      }

      return { cancel: () => {} }
    }
  }
}

/**
 * Wait for a condition to be true
 * Useful for async testing
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Collect chunks from a streaming response
 */
export async function collectStreamChunks(
  streamFn: (onChunk: (text: string) => void) => Promise<void>
): Promise<string> {
  let result = ''

  await streamFn((chunk) => {
    result += chunk
  })

  return result
}

/**
 * Create a mock FlowAPI for testing nodes
 */
export function createMockFlowAPI(overrides?: Partial<FlowAPI>): FlowAPI & {
  _testHelpers: {
    logs: Array<{ level: string; message: string; data?: any }>
    badges: Map<string, Badge>
    streamChunks: string[]
    usageReports: UsageReport[]
    emittedEvents: any[]
  }
} {
  const logs: Array<{ level: string; message: string; data?: any }> = []
  const badges: Map<string, Badge> = new Map()
  const streamChunks: string[] = []
  const usageReports: UsageReport[] = []
  const emittedEvents: any[] = []
  const portalRegistry = new Map<string, { context?: MainFlowContext; data?: any }>()

  const mockStore: any = {
    getNodeCache: jest.fn(() => null),
    setNodeCache: jest.fn(),
    clearNodeCache: jest.fn(),
    feSetPortalData: jest.fn(),
    feGetPortalData: jest.fn(() => null),
    feHandleIntentDetected: jest.fn(),
    feWaitForUserInput: jest.fn(() => Promise.resolve('mock user input'))
  }

  const contextRef = { current: createMainFlowContext() }
  const contextManager = createContextManager(contextRef)
  const isolatedContexts: MainFlowContext[] = []

  const contextsHelper: FlowAPI['contexts'] = {
    active: () => cloneContext(contextManager.get()),
    list: () => [cloneContext(contextManager.get()), ...isolatedContexts.map(cloneContext)],
    get: (contextId: string) => {
      if (!contextId) return undefined
      const active = contextManager.get()
      if (active.contextId === contextId) {
        return cloneContext(active)
      }
      const found = isolatedContexts.find(ctx => ctx.contextId === contextId)
      return found ? cloneContext(found) : undefined
    },
    createIsolated: (options: CreateIsolatedContextOptions) => {
      const snapshot = createIsolatedContextSnapshot(contextManager, options, isolatedContexts)
      isolatedContexts.push(snapshot)
      return cloneContext(snapshot)
    },
    release: (contextId: string) => {
      const index = isolatedContexts.findIndex(ctx => ctx.contextId === contextId)
      if (index >= 0) {
        isolatedContexts.splice(index, 1)
        return true
      }
      return false
    },
  }

  const triggerPortalOutputs = jest.fn(async (_portalId: string) => {})
  const setPortalData = jest.fn((portalId: string, context?: MainFlowContext, data?: any) => {
    portalRegistry.set(portalId, { context, data })
  })
  const getPortalData = jest.fn((portalId: string) => portalRegistry.get(portalId))

  const base: FlowAPI = {
    nodeId: 'test-node',
    requestId: 'test-request',
    executionId: 'test-exec',
    workspaceId: 'test-workspace',
    signal: new AbortController().signal,
    checkCancelled: jest.fn(),
    store: mockStore,
    context: contextManager,
    contexts: contextsHelper,
    conversation: {
      streamChunk: jest.fn((chunk: string) => {
        streamChunks.push(chunk)
      }),
      addBadge: jest.fn((badge: Badge) => {
        const id = `badge-${badges.size + 1}`
        badges.set(id, badge)
        return id
      }),
      updateBadge: jest.fn((badgeId: string, updates: Partial<Badge>) => {
        const existing = badges.get(badgeId)
        if (existing) {
          badges.set(badgeId, { ...existing, ...updates })
        }
      })
    },
    log: {
      debug: jest.fn((message: string, data?: any) => {
        logs.push({ level: 'debug', message, data })
      }),
      info: jest.fn((message: string, data?: any) => {
        logs.push({ level: 'info', message, data })
      }),
      warn: jest.fn((message: string, data?: any) => {
        logs.push({ level: 'warn', message, data })
      }),
      error: jest.fn((message: string, data?: any) => {
        logs.push({ level: 'error', message, data })
      })
    },
    tools: {
      execute: jest.fn(async (toolName: string) => {
        return { result: `Mock execution of ${toolName}` }
      }),
      list: jest.fn(() => [])
    },
    usage: {
      report: jest.fn((report: UsageReport) => {
        usageReports.push(report)
      })
    },
    waitForUserInput: jest.fn(() => mockStore.feWaitForUserInput()),
    triggerPortalOutputs,
    setPortalData,
    getPortalData,
    emitExecutionEvent: jest.fn((event) => {
      emittedEvents.push(event)
    })
  }

  const merged = { ...base, ...overrides } as FlowAPI & {
    _testHelpers: {
      logs: Array<{ level: string; message: string; data?: any }>
      badges: Map<string, Badge>
      streamChunks: string[]
      usageReports: UsageReport[]
      emittedEvents: any[]
    }
  }

  merged._testHelpers = {
    logs,
    badges,
    streamChunks,
    usageReports,
    emittedEvents
  }

  return merged
}

/**
 * Create mock NodeInputs for testing
 */
export function createMockNodeInputs(
  pushedInputs: Record<string, any> = {}
): NodeInputs {
  return {
    has: jest.fn((inputName: string) => inputName in pushedInputs),
    pull: jest.fn(async (inputName: string) => {
      if (inputName in pushedInputs) {
        return pushedInputs[inputName]
      }
      throw new Error(`No input available for: ${inputName}`)
    })
  }
}

/**
 * Create a MainFlowContext for testing (replaces createTestContext for new architecture)
 */
export function createMainFlowContext(overrides?: Partial<MainFlowContext>): MainFlowContext {
  return {
    contextId: 'test-context-' + Date.now(),
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    systemInstructions: 'You are a helpful assistant.',
    messageHistory: [],
    ...overrides
  }
}

function cloneContext(context: MainFlowContext): MainFlowContext {
  return {
    ...context,
    messageHistory: Array.isArray(context.messageHistory)
      ? context.messageHistory.map(msg => ({ ...msg }))
      : []
  }
}

function createIsolatedContextSnapshot(
  manager: ContextManager,
  options: CreateIsolatedContextOptions,
  isolatedContexts: MainFlowContext[],
): MainFlowContext {
  const active = manager.get()
  const base = options.baseContextId
    ? isolatedContexts.find(ctx => ctx.contextId === options.baseContextId) || active
    : active

  const inheritedHistory = options.inheritHistory ? cloneHistory(base.messageHistory) : []
  const seededHistory = options.initialMessages?.length ? sanitizeMessages(options.initialMessages) : []
  const systemInstructions =
    options.systemInstructions !== undefined
      ? options.systemInstructions
      : options.inheritSystemInstructions
        ? base.systemInstructions
        : ''

  return {
    contextId: crypto.randomUUID(),
    contextType: 'isolated',
    provider: options.provider || base.provider,
    model: options.model || base.model,
    systemInstructions,
    ...(options.label ? { label: options.label } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    ...(options.includeThoughts !== undefined ? { includeThoughts: options.includeThoughts } : {}),
    ...(options.thinkingBudget !== undefined ? { thinkingBudget: options.thinkingBudget } : {}),
    ...(options.modelOverrides?.length ? { modelOverrides: options.modelOverrides } : {}),
    parentContextId: base.contextId,
    createdByNodeId: options.createdByNodeId,
    createdAt: new Date().toISOString(),
    messageHistory: [...inheritedHistory, ...seededHistory],
  }
}

function cloneHistory(history?: MainFlowContext['messageHistory']): MainFlowContext['messageHistory'] {
  if (!Array.isArray(history)) return []
  return history.map(msg => ({
    ...msg,
    metadata: msg.metadata ? { ...msg.metadata } : undefined,
  }))
}

const VALID_ROLES: Array<MainFlowContext['messageHistory'][number]['role']> = ['system', 'user', 'assistant']

function sanitizeMessages(
  messages?: MainFlowContext['messageHistory']
): MainFlowContext['messageHistory'] {
  if (!Array.isArray(messages)) return []
  const sanitized: MainFlowContext['messageHistory'] = []
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') {
      continue
    }
    const role = VALID_ROLES.includes(msg.role) ? msg.role : 'assistant'
    sanitized.push({
      ...msg,
      role,
      content: String(msg.content),
      metadata: msg.metadata ? { ...msg.metadata } : undefined,
    })
  }
  return sanitized
}

