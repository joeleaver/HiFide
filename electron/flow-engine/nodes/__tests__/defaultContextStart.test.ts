/**
 * Tests for defaultContextStart node
 */

import { defaultContextStartNode } from '../defaultContextStart'
import {
  createMainFlowContext,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../__tests__/utils/testHelpers'

describe('defaultContextStart Node', () => {
  it('should set system instructions from config', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext()
    const config = {
      systemInstructions: 'You are a helpful assistant.'
    }
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('You are a helpful assistant.')
  })

  it('should preserve existing system instructions if config is empty', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext({
      systemInstructions: 'Existing instructions'
    })
    const config = {}
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('Existing instructions')
  })

  it('should override existing system instructions with config', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext({
      systemInstructions: 'Old instructions'
    })
    const config = {
      systemInstructions: 'New instructions'
    }
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('New instructions')
  })

  it('should handle empty string system instructions', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext()
    const config = {
      systemInstructions: ''
    }
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, config)

    expect(result.status).toBe('success')
    // Empty string should be treated as falsy, so it falls back to contextIn
    expect(result.context?.systemInstructions).toBe(context.systemInstructions)
  })

  it('should fill missing provider/model from global store when context is provided', async () => {
    const baseFlow = createMockFlowAPI()
    const flow = {
      ...baseFlow,
      store: {
        ...baseFlow.store,
        selectedProvider: 'gemini',
        selectedModel: 'gemini-2.0-flash-exp'
      }
    } as any

    // Simulate a scheduler-pushed context with missing provider/model
    const context = createMainFlowContext({ provider: '' as any, model: '' as any })
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, {})

    expect(result.status).toBe('success')
    expect(result.context?.provider).toBe('gemini')
    expect(result.context?.model).toBe('gemini-2.0-flash-exp')
    expect((result.context as any).contextType).toBe('main')
  })

  it('should override provider/model with global selection even when context has values', async () => {
    const baseFlow = createMockFlowAPI()
    const flow = {
      ...baseFlow,
      store: {
        ...baseFlow.store,
        selectedProvider: 'openai',
        selectedModel: 'gpt-4.1'
      }
    } as any

    // Context has provider/model that should be overridden by global selection
    const context = createMainFlowContext({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' })
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, {})

    expect(result.status).toBe('success')
    expect(result.context?.provider).toBe('openai')
    expect(result.context?.model).toBe('gpt-4.1')
  })

  it('sanitizes trailing unmatched user message', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext({
      messageHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Again' }
      ]
    })
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, {})

    expect(result.status).toBe('success')
    expect(result.context?.messageHistory.length).toBe(2)
    expect(result.context?.messageHistory[0].role).toBe('user')
    expect(result.context?.messageHistory[1].role).toBe('assistant')
    expect(result.context?.messageHistory[1].content).toBe('Hello')
  })

  it('sanitizes trailing blank assistant reply (drops the incomplete pair)', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext({
      messageHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Again' },
        { role: 'assistant', content: '   ' }
      ]
    })
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, {})

    expect(result.status).toBe('success')
    expect(result.context?.messageHistory.length).toBe(2)
    expect(result.context?.messageHistory[1].role).toBe('assistant')
    expect(result.context?.messageHistory[1].content).toBe('Hello')
  })

  it('sanitizes dangling assistant without preceding user', async () => {
    const flow = createMockFlowAPI()
    const context = createMainFlowContext({
      messageHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'Oops' }
      ]
    })
    const inputs = createMockNodeInputs()

    const result = await defaultContextStartNode(flow, context, undefined, inputs, {})

    expect(result.status).toBe('success')
    expect(result.context?.messageHistory.length).toBe(2)
    expect(result.context?.messageHistory[0].role).toBe('user')
    expect(result.context?.messageHistory[1].role).toBe('assistant')
    expect(result.context?.messageHistory[1].content).toBe('Hello')
  })
})

