/**
 * Tests for newContext node
 */

import { newContextNode } from '../newContext'
import type { MainFlowContext } from '../../types'
import {
  createMainFlowContext,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../__tests__/utils/testHelpers'

describe('New Context Node', () => {
  const createNodeConfig = (overrides?: any) => ({
    provider: 'openai',
    model: 'gpt-4o',
    systemInstructions: 'You are a helpful assistant.',
    _nodeId: 'test-newContext',
    ...overrides
  })

  const createTestMainContext = (): MainFlowContext => ({
    contextId: 'main',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    systemInstructions: 'Main context instructions',
    messageHistory: [
      { role: 'user', content: 'Hello from main context' },
      { role: 'assistant', content: 'Hi there!' }
    ]
  })

  describe('Basic Functionality', () => {
    it('should create a new isolated context', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig()
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, context, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context).toBeDefined()
      expect(result.context.provider).toBe('openai')
      expect(result.context.model).toBe('gpt-4o')
      expect(result.context.systemInstructions).toBe('You are a helpful assistant.')
      expect(result.context.messageHistory).toEqual([])
    })

    it('should generate unique isolated context IDs per invocation', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig()
      const inputs = createMockNodeInputs()

      const result1 = await newContextNode(flow, context, undefined, inputs, config)
      const result2 = await newContextNode(flow, context, undefined, inputs, config)

      expect(result1.context).toBeDefined()
      expect(result2.context).toBeDefined()
      expect(result1.context.contextId).toBeDefined()
      expect(result2.context.contextId).toBeDefined()
      expect(result1.context.contextId).not.toBe(result2.context.contextId)
      expect(result1.context.contextType).toBe('isolated')
      expect(result2.context.contextType).toBe('isolated')
    })

    it('should pass through data input', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig()
      const dataIn = 'Some data to pass through'
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, context, dataIn, inputs, config)

      expect(result.status).toBe('success')
      expect(result.data).toBe(dataIn)
    })
  })

  describe('Context Isolation', () => {
    it('should not inherit message history from input context', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const mainContext = createTestMainContext()
      const config = createNodeConfig()
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, mainContext, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.messageHistory).toEqual([])
      expect(result.context.messageHistory.length).toBe(0)
    })

    it('should not inherit provider/model from input context', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const mainContext = createTestMainContext()
      const config = createNodeConfig({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      })
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, mainContext, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.provider).toBe('gemini')
      expect(result.context.model).toBe('gemini-2.0-flash-exp')
      // Should NOT be the main context's provider/model
      expect(result.context.provider).not.toBe(mainContext.provider)
      expect(result.context.model).not.toBe(mainContext.model)
    })

    it('should not inherit system instructions from input context', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const mainContext = createTestMainContext()
      const config = createNodeConfig({
        systemInstructions: 'Bootstrap context instructions'
      })
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, mainContext, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.systemInstructions).toBe('Bootstrap context instructions')
      expect(result.context.systemInstructions).not.toBe(mainContext.systemInstructions)
    })
  })

  describe('Configuration', () => {
    it('should use default provider when not specified', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig({ provider: undefined })
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, context, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.provider).toBe('openai')
    })

    it('should use default model when not specified', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig({ model: undefined })
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, context, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.model).toBe('gpt-4o')
    })

    it('should use empty system instructions when not specified', async () => {
      const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
      const context = createMainFlowContext()
      const config = createNodeConfig({ systemInstructions: undefined })
      const inputs = createMockNodeInputs()

      const result = await newContextNode(flow, context, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.context.systemInstructions).toBe('')
    })

    it('should support all three providers', async () => {
      const providers = [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'gemini', model: 'gemini-2.0-flash-exp' }
      ]

      for (const { provider, model } of providers) {
        const flow = createMockFlowAPI({ nodeId: 'test-newContext' })
        const context = createMainFlowContext()
        const config = createNodeConfig({ provider, model })
        const inputs = createMockNodeInputs()

        const result = await newContextNode(flow, context, undefined, inputs, config)

        expect(result.status).toBe('success')
        expect(result.context.provider).toBe(provider)
        expect(result.context.model).toBe(model)
      }
    })
  })
})

