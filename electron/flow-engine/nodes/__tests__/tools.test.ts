/**
 * Tools Node Tests
 */

import { toolsNode } from '../tools'
import {
  createMainFlowContext,
  createTestConfig,
  createTestTool,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../__tests__/utils/testHelpers'

describe('Tools Node', () => {
  const mockTools = [
    createTestTool('tool1'),
    createTestTool('tool2'),
    createTestTool('tool3'),
  ]

  describe('Auto Mode', () => {
    it('should return all tools when config is "auto"', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: 'auto' })
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(3)
      expect(result.tools.map((t: any) => t.name)).toEqual(['tool1', 'tool2', 'tool3'])
    })

    it('should return all tools when config is not specified', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig()
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(3)
    })
  })

  describe('Specific Tools Mode', () => {
    it('should return only specified tools', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: ['tool1', 'tool3'] })
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(2)
      expect(result.tools.map((t: any) => t.name)).toEqual(['tool1', 'tool3'])
    })

    it('should return empty array when no tools match', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: ['nonexistent'] })
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(0)
    })
  })

  describe('MCP Tool Integration', () => {
    it('should include MCP tools even when they are not explicitly selected', async () => {
      const flow = createMockFlowAPI()
      const mcpTool = createTestTool('mcp.server.weather')
      flow.tools.list = jest.fn(() => [...mockTools, mcpTool])
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: ['tool1'] })
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools.map((t: any) => t.name)).toEqual(['tool1', 'mcp.server.weather'])
    })
  })

  describe('Dynamic Override', () => {
    it('should override config with dataIn', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: 'auto' })
      const dataIn = JSON.stringify(['tool2'])
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, dataIn, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('tool2')
    })

    it('should ignore invalid JSON in dataIn', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext()
      const config = createTestConfig({ tools: ['tool1'] })
      const dataIn = 'not valid json'
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, dataIn, inputs, config)

      expect(result.status).toBe('success')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('tool1')
    })
  })

  describe('Context Pass-through', () => {
    it('should pass through context unchanged', async () => {
      const flow = createMockFlowAPI()
      flow.tools.list = jest.fn(() => mockTools)
      const context = createMainFlowContext({
        messageHistory: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' }
        ]
      })
      const config = createTestConfig()
      const inputs = createMockNodeInputs()

      const result = await toolsNode(flow, context, null, inputs, config)

      expect(result.context).toEqual(context)
      expect(result.context.messageHistory).toHaveLength(2)
    })
  })
})

