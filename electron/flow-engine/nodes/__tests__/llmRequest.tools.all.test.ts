/**
 * LLM Request Node - Tools Coverage Tests
 *
 * Verifies that llmRequest can consume every tool by routing through llmService
 * and a mock provider's agentStream implementation that deterministically calls
 * the provided tool and streams the result.
 */

import type { AgentTool, ProviderAdapter } from '../../../../providers/provider'
import { llmRequestNode } from '../llmRequest'
import { agentTools } from '../../../../tools'
import {
  createMainFlowContext,
  createMockFlowAPI,
  createMockNodeInputs,
  createTestConfig
} from '../../../__tests__/utils/testHelpers'

// Mock sendFlowEvent since we don't have WebContents in tests
jest.mock('../../events', () => ({
  sendFlowEvent: jest.fn()
}))

// Install a mock provider registry for llm-service
jest.mock('../../../../core/state', () => {
  // Minimal tool-calling mock provider
  const MockProvider: ProviderAdapter = {
    id: 'mock',
    async agentStream({ tools, onChunk, onDone, onError, onToolStart, onToolEnd, toolMeta }) {
      try {
        const tool = tools?.[0]
        if (!tool) throw new Error('No tool provided')
        const args = { input: 'demo' }
        onToolStart?.({ name: tool.name, arguments: args })
        const result = await tool.run(args, toolMeta)
        onToolEnd?.({ name: tool.name, result })
        onChunk(JSON.stringify({ provider: 'mock', tool: tool.name, result }))
        onDone()
      } catch (e: any) {
        onError(e.message || String(e))
      }
      return { cancel: () => {} }
    }
  }

  return {
    providers: { mock: MockProvider },
    getProviderKey: jest.fn(async () => 'mock-key')
  }
})

// Mock the rate limit tracker to bypass provider/model checks in tests
jest.mock('../../../../providers/rate-limit-tracker', () => ({
  rateLimitTracker: {
    checkAndWait: jest.fn(async () => 0),
    updateFromHeaders: jest.fn(),
    updateFromError: jest.fn(),
    recordRequest: jest.fn(),
    clearLimits: jest.fn(),
    getLimits: jest.fn(),
    getState: jest.fn(),
  }
}))

// Wrap real tools so we don't perform destructive operations during these
// integration tests; preserve name/parameters for registry parity
function makeWrappedTool(tool: AgentTool): AgentTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    run: async (input: any, meta?: any) => ({ ok: true, name: tool.name, input, meta })
  }
}

// Some tools may require environment resources (terminal/index). We can skip
// them here; they should have dedicated tests. Adjust list as needed.
const SKIP_SET = new Set<string>([
  'terminal.exec',
  'terminal.session_search_output',
  'terminal.session_tail',
  'terminal.session_restart',
  'index.search'
])

describe('LLM Request Node - tools integration (mock provider)', () => {
  const wrappedTools: AgentTool[] = agentTools.map(makeWrappedTool)

  for (const tool of wrappedTools) {
    const title = `should call tool via agentStream: ${tool.name}`
    const testFn = SKIP_SET.has(tool.name) ? it.skip : it

    testFn(title, async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
      const inputs = createMockNodeInputs({ tools: [tool] })
      const config = createTestConfig()

      const message = `Use the tool now: ${tool.name}`

      const result = await llmRequestNode(flow as any, context as any, message, inputs as any, config)

      expect(result.status).toBe('success')
      expect(typeof result.data).toBe('string')

      // Response is a JSON string from the mock provider
      const parsed = JSON.parse(result.data as string)
      expect(parsed.provider).toBe('mock')
      expect(parsed.tool).toBe(tool.name)
      expect(parsed.result).toBeDefined()

      // Context should include user + assistant messages
      expect(result.context.messageHistory.length).toBeGreaterThanOrEqual(2)
      expect(result.context.messageHistory[result.context.messageHistory.length - 1].role).toBe('assistant')
    })
  }
})

