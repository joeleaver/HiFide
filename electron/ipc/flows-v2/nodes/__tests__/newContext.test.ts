/**
 * Tests for newContext node
 */

import { newContextNode } from '../newContext'
import type { MainFlowContext } from '../../types'

describe('New Context Node', () => {
  const createTestConfig = (overrides?: any) => ({
    provider: 'openai',
    model: 'gpt-4o',
    systemInstructions: 'You are a helpful assistant.',
    _nodeId: 'test-newContext',
    ...overrides
  })

  const createTestContext = (): MainFlowContext => ({
    contextId: 'main',
    contextType: 'main',
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
      const config = createTestConfig()
      const result = await newContextNode(undefined as any, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context).toBeDefined()
      expect(result.context.contextType).toBe('isolated')
      expect(result.context.provider).toBe('openai')
      expect(result.context.model).toBe('gpt-4o')
      expect(result.context.systemInstructions).toBe('You are a helpful assistant.')
      expect(result.context.messageHistory).toEqual([])
    })

    it('should generate unique context ID', async () => {
      const config = createTestConfig()
      const result1 = await newContextNode(undefined as any, undefined, {}, config)
      
      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const result2 = await newContextNode(undefined as any, undefined, {}, config)

      expect(result1.context.contextId).not.toBe(result2.context.contextId)
      expect(result1.context.contextId).toMatch(/^context-test-newContext-\d+$/)
      expect(result2.context.contextId).toMatch(/^context-test-newContext-\d+$/)
    })

    it('should pass through data input', async () => {
      const config = createTestConfig()
      const dataIn = 'Some data to pass through'
      const result = await newContextNode(undefined as any, dataIn, {}, config)

      expect(result.status).toBe('success')
      expect(result.data).toBe(dataIn)
    })
  })

  describe('Context Isolation', () => {
    it('should not inherit message history from input context', async () => {
      const mainContext = createTestContext()
      const config = createTestConfig()
      
      const result = await newContextNode(mainContext, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.messageHistory).toEqual([])
      expect(result.context.messageHistory.length).toBe(0)
    })

    it('should not inherit provider/model from input context', async () => {
      const mainContext = createTestContext()
      const config = createTestConfig({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      })
      
      const result = await newContextNode(mainContext, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.provider).toBe('gemini')
      expect(result.context.model).toBe('gemini-2.0-flash-exp')
      // Should NOT be the main context's provider/model
      expect(result.context.provider).not.toBe(mainContext.provider)
      expect(result.context.model).not.toBe(mainContext.model)
    })

    it('should not inherit system instructions from input context', async () => {
      const mainContext = createTestContext()
      const config = createTestConfig({
        systemInstructions: 'Bootstrap context instructions'
      })
      
      const result = await newContextNode(mainContext, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.systemInstructions).toBe('Bootstrap context instructions')
      expect(result.context.systemInstructions).not.toBe(mainContext.systemInstructions)
    })
  })

  describe('Configuration', () => {
    it('should use default provider when not specified', async () => {
      const config = createTestConfig({ provider: undefined })
      const result = await newContextNode(undefined as any, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.provider).toBe('openai')
    })

    it('should use default model when not specified', async () => {
      const config = createTestConfig({ model: undefined })
      const result = await newContextNode(undefined as any, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.model).toBe('gpt-4o')
    })

    it('should use empty system instructions when not specified', async () => {
      const config = createTestConfig({ systemInstructions: undefined })
      const result = await newContextNode(undefined as any, undefined, {}, config)

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
        const config = createTestConfig({ provider, model })
        const result = await newContextNode(undefined as any, undefined, {}, config)

        expect(result.status).toBe('success')
        expect(result.context.provider).toBe(provider)
        expect(result.context.model).toBe(model)
      }
    })
  })

  describe('Context Type', () => {
    it('should always mark context as isolated', async () => {
      const config = createTestConfig()
      const result = await newContextNode(undefined as any, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.contextType).toBe('isolated')
    })

    it('should mark as isolated even when input context is main', async () => {
      const mainContext = createTestContext()
      expect(mainContext.contextType).toBe('main')

      const config = createTestConfig()
      const result = await newContextNode(mainContext, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context.contextType).toBe('isolated')
    })
  })
})

