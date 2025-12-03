import { userInputNode } from '../userInput'
import { createMockFlowAPI, createMockNodeInputs } from '../../../__tests__/utils/testHelpers'

describe('userInput node', () => {
  it('appends trimmed user input to context history', async () => {
    const flow = createMockFlowAPI({
      waitForUserInput: jest.fn().mockResolvedValue('  Hello world  '),
    })

    const context = flow.context.get()
    expect(context.messageHistory).toHaveLength(0)

    const result = await userInputNode(flow, context, undefined, createMockNodeInputs(), {})

    expect(result.status).toBe('success')
    expect(result.data).toBe('  Hello world  ')

    const history = flow.context.get().messageHistory
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({ role: 'user', content: 'Hello world' })
  })

  it('skips context mutation when the user input is empty', async () => {
    const flow = createMockFlowAPI({
      waitForUserInput: jest.fn().mockResolvedValue('   '),
    })

    const context = flow.context.get()
    const result = await userInputNode(flow, context, undefined, createMockNodeInputs(), {})

    expect(result.status).toBe('success')
    expect(result.data).toBe('   ')
    expect(flow.context.get().messageHistory).toHaveLength(0)
  })
})
