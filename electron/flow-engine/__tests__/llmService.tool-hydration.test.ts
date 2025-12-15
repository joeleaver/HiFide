/**
 * Ensures llmService hydrates Flow node tool descriptors into executable agent tools
 * before invoking provider adapters.
 */

import { llmService } from '../llm-service'
import { createMockFlowAPI } from '../../__tests__/utils/testHelpers'

const runSpy = jest.fn(async (input: any) => ({
  tool: 'fsReadFile',
  input,
  ok: true
}))

jest.mock('../../tools/agentToolRegistry', () => ({
  getAgentToolSnapshot: jest.fn(() => ([
    {
      name: 'fsReadFile',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      run: runSpy
    }
  ]))
}))

jest.mock('../../core/state', () => {
  const mockProvider = {
    id: 'mock',
    async agentStream({ tools, onChunk, onDone, onError }: any) {
      try {
        const tool = tools?.[0]
        if (!tool) throw new Error('No tool provided')
        const result = await tool.run({ path: 'README.md' })
        onChunk(JSON.stringify(result))
        onDone?.()
      } catch (error: any) {
        onError?.(error?.message || String(error))
      }
      return { cancel: () => {} }
    }
  }

  return {
    providers: { mock: mockProvider },
    getProviderKey: jest.fn(async () => 'mock-key')
  }
})

describe('llmService tool hydration', () => {
  beforeEach(() => {
    runSpy.mockClear()
  })

  it('hydrates plain tool descriptors into executable agent tools', async () => {
    const flow = createMockFlowAPI()
    flow.context.setProviderModel('mock', 'mock-001')

    const result = await llmService.chat({
      message: 'Use the file reader',
      tools: [
        {
          name: 'fsReadFile',
          description: 'Read file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } }
        }
      ],
      flowAPI: flow
    })

    expect(result.error).toBeUndefined()
    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(result.text || '{}').tool).toBe('fsReadFile')
  })
})
