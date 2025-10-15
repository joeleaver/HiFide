/**
 * Example test to verify Jest setup
 */

import { createTestContext, createTestConfig, createTestTool } from './utils/testHelpers'

describe('Test Infrastructure', () => {
  describe('Test Helpers', () => {
    it('should create test context with defaults', () => {
      const context = createTestContext()
      
      expect(context.provider).toBe('anthropic')
      expect(context.model).toBeDefined()
      expect(context.messageHistory).toEqual([])
      expect(context.sessionId).toContain('test-session-')
    })

    it('should create test context with overrides', () => {
      const context = createTestContext({
        provider: 'openai',
        model: 'gpt-4',
        systemInstructions: 'Custom instructions'
      })
      
      expect(context.provider).toBe('openai')
      expect(context.model).toBe('gpt-4')
      expect(context.systemInstructions).toBe('Custom instructions')
    })

    it('should create test config', () => {
      const config = createTestConfig({ customKey: 'value' })
      
      expect(config._nodeId).toBe('test-node')
      expect(config.customKey).toBe('value')
    })

    it('should create test tool', () => {
      const tool = createTestTool('my_tool')
      
      expect(tool.name).toBe('my_tool')
      expect(tool.description).toContain('my_tool')
      expect(tool.parameters).toBeDefined()
      expect(typeof tool.run).toBe('function')
    })

    it('should execute test tool', async () => {
      const tool = createTestTool('test')
      const result = await tool.run({ input: 'hello' })
      
      expect(result).toBeDefined()
      expect(result.result).toContain('test')
      expect(result.result).toContain('hello')
    })
  })

  describe('Basic Jest Functionality', () => {
    it('should run basic assertions', () => {
      expect(1 + 1).toBe(2)
      expect('hello').toBe('hello')
      expect([1, 2, 3]).toHaveLength(3)
    })

    it('should handle async tests', async () => {
      const result = await Promise.resolve('async result')
      expect(result).toBe('async result')
    })

    it('should handle object matching', () => {
      const obj = { a: 1, b: 2, c: 3 }
      
      expect(obj).toEqual({ a: 1, b: 2, c: 3 })
      expect(obj).toHaveProperty('a', 1)
      expect(obj).toMatchObject({ a: 1, b: 2 })
    })
  })
})

