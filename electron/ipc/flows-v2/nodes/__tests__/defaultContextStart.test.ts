/**
 * Tests for defaultContextStart node
 */

import { defaultContextStartNode } from '../defaultContextStart'
import { createTestContext, createTestConfig } from '../../../../__tests__/utils/testHelpers'

describe('defaultContextStart Node', () => {
  it('should set system instructions from config', async () => {
    const context = createTestContext()
    const config = {
      systemInstructions: 'You are a helpful assistant.'
    }

    const result = await defaultContextStartNode(context, undefined, {}, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('You are a helpful assistant.')
  })

  it('should preserve existing system instructions if config is empty', async () => {
    const context = createTestContext({
      systemInstructions: 'Existing instructions'
    })
    const config = {}

    const result = await defaultContextStartNode(context, undefined, {}, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('Existing instructions')
  })

  it('should override existing system instructions with config', async () => {
    const context = createTestContext({
      systemInstructions: 'Old instructions'
    })
    const config = {
      systemInstructions: 'New instructions'
    }

    const result = await defaultContextStartNode(context, undefined, {}, config)

    expect(result.status).toBe('success')
    expect(result.context?.systemInstructions).toBe('New instructions')
  })

  it('should handle empty string system instructions', async () => {
    const context = createTestContext()
    const config = {
      systemInstructions: ''
    }

    const result = await defaultContextStartNode(context, undefined, {}, config)

    expect(result.status).toBe('success')
    // Empty string should be treated as falsy, so it falls back to contextIn
    expect(result.context?.systemInstructions).toBe(context.systemInstructions)
  })
})

