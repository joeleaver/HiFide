/**
 * Verifies llmService doesn9 append duplicate user messages when upstream
 * nodes already inserted the pending text into context history.
 */

import { llmService } from '../llm-service'
import { createMockFlowAPI } from '../../__tests__/utils/testHelpers'

jest.mock('../../tools/agentToolRegistry', () => ({
  getAgentToolSnapshot: jest.fn(() => [])
}))

jest.mock('../../core/state', () => {
  const agentStreamSpy = jest.fn(async ({ onChunk, onDone, onError }: any) => {
    try {
      onChunk?.('mock response')
      onDone?.()
    } catch (error: any) {
      onError?.(error?.message || String(error))
    }
    return { cancel: () => {} }
  })

  return {
    providers: {
      mock: {
        id: 'mock',
        agentStream: agentStreamSpy
      }
    },
    getProviderKey: jest.fn(async () => 'mock-key'),
    __agentStreamSpy: agentStreamSpy
  }
})

const { __agentStreamSpy: agentStreamSpy } = jest.requireMock('../../core/state') as {
  __agentStreamSpy: jest.Mock
}

describe('llmService message history handling', () => {
  beforeEach(() => {
    agentStreamSpy.mockClear()
  })

  it('does not append a duplicate user message when it already exists', async () => {
    const flow = createMockFlowAPI()
    flow.context.setProviderModel('mock', 'mock-001')

    // Simulate userInput node already appending the trimmed text
    flow.context.addMessage({ role: 'user', content: 'Hello there' })

    const result = await llmService.chat({
      message: 'Hello there   ',
      flowAPI: flow
    })

    expect(result.error).toBeUndefined()

    const history = flow.context.get().messageHistory
    const userMessages = history.filter((entry) => entry.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toBe('Hello there')
  })

  it('appends user message when it is not already present', async () => {
    const flow = createMockFlowAPI()
    flow.context.setProviderModel('mock', 'mock-001')

    const result = await llmService.chat({
      message: 'Brand new prompt',
      flowAPI: flow
    })

    expect(result.error).toBeUndefined()

    const history = flow.context.get().messageHistory
    const userMessages = history.filter((entry) => entry.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toBe('Brand new prompt')
  })
})
