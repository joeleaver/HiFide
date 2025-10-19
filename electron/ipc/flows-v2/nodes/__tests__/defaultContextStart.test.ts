/**
 * Tests for defaultContextStart node
 */

import { defaultContextStartNode } from '../defaultContextStart'
import {
  createMainFlowContext,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../../__tests__/utils/testHelpers'

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
})

