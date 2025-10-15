/**
 * Tools Node Tests
 */

import { toolsNode } from '../tools'
import { createTestContext, createTestConfig, createTestTool } from '../../../../__tests__/utils/testHelpers'

describe('Tools Node', () => {
  beforeAll(() => {
    // Set up global tools
    (globalThis as any).__agentTools = [
      createTestTool('tool1'),
      createTestTool('tool2'),
      createTestTool('tool3'),
    ]
  })

  afterAll(() => {
    // Clean up
    delete (globalThis as any).__agentTools
  })

  describe('Auto Mode', () => {
    it('should return all tools when config is "auto"', async () => {
      const context = createTestContext()
      const config = createTestConfig({ tools: 'auto' })

      const result = await toolsNode(context, null, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(3)
      expect(result.tools.map((t: any) => t.name)).toEqual(['tool1', 'tool2', 'tool3'])
    })

    it('should return all tools when config is not specified', async () => {
      const context = createTestContext()
      const config = createTestConfig()

      const result = await toolsNode(context, null, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(3)
    })
  })

  describe('Specific Tools Mode', () => {
    it('should return only specified tools', async () => {
      const context = createTestContext()
      const config = createTestConfig({ tools: ['tool1', 'tool3'] })

      const result = await toolsNode(context, null, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(2)
      expect(result.tools.map((t: any) => t.name)).toEqual(['tool1', 'tool3'])
    })

    it('should return empty array when no tools match', async () => {
      const context = createTestContext()
      const config = createTestConfig({ tools: ['nonexistent'] })

      const result = await toolsNode(context, null, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(0)
    })
  })

  describe('Dynamic Override', () => {
    it('should override config with dataIn', async () => {
      const context = createTestContext()
      const config = createTestConfig({ tools: 'auto' })
      const dataIn = JSON.stringify(['tool2'])

      const result = await toolsNode(context, dataIn, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('tool2')
    })

    it('should ignore invalid JSON in dataIn', async () => {
      const context = createTestContext()
      const config = createTestConfig({ tools: ['tool1'] })
      const dataIn = 'not valid json'

      const result = await toolsNode(context, dataIn, {}, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('tool1')
    })
  })

  describe('Context Pass-through', () => {
    it('should pass through context unchanged', async () => {
      const context = createTestContext({
        messageHistory: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' }
        ]
      })
      const config = createTestConfig()

      const result = await toolsNode(context, null, {}, config)

      expect(result.context).toEqual(context)
      expect(result.context.messageHistory).toHaveLength(2)
    })
  })
})

