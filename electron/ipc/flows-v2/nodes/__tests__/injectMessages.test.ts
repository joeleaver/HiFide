/**
 * Tests for injectMessages node
 */

import { injectMessagesNode } from '../injectMessages'
import { createTestContext, createTestConfig } from '../../../../__tests__/utils/testHelpers'

describe('injectMessages Node', () => {
  describe('Append mode', () => {
    it('should add messages to end of history on first insertion', async () => {
      const context = createTestContext({
        messageHistory: [
          { role: 'user', content: 'Existing message' },
          { role: 'assistant', content: 'Existing response' },
        ]
      })
      const config = createTestConfig({
        staticUserMessage: 'Bootstrap question',
        staticAssistantMessage: 'Bootstrap answer',
        injectionMode: 'append',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context?.messageHistory).toHaveLength(4)
      expect(result.context?.messageHistory[2]).toMatchObject({
        role: 'user',
        content: 'Bootstrap question',
      })
      expect(result.context?.messageHistory[3]).toMatchObject({
        role: 'assistant',
        content: 'Bootstrap answer',
      })
    })
  })

  describe('Prepend mode', () => {
    it('should add messages to beginning of history on first insertion', async () => {
      const context = createTestContext({
        messageHistory: [
          { role: 'user', content: 'Existing message' },
          { role: 'assistant', content: 'Existing response' },
        ]
      })
      const config = createTestConfig({
        staticUserMessage: 'Bootstrap question',
        staticAssistantMessage: 'Bootstrap answer',
        injectionMode: 'prepend',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context?.messageHistory).toHaveLength(4)
      expect(result.context?.messageHistory[0]).toMatchObject({
        role: 'user',
        content: 'Bootstrap question',
      })
      expect(result.context?.messageHistory[1]).toMatchObject({
        role: 'assistant',
        content: 'Bootstrap answer',
      })
    })

    it('should default to prepend mode if not specified', async () => {
      const context = createTestContext({
        messageHistory: []
      })
      const config = createTestConfig({
        staticUserMessage: 'Question',
        staticAssistantMessage: 'Answer',
        // No injectionMode specified
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('success')
      expect(result.context?.messageHistory).toHaveLength(2)
      expect(result.context?.messageHistory[0].role).toBe('user')
    })
  })

  describe('Idempotent updates', () => {
    it('should update messages in place when run twice (append mode)', async () => {
      const context = createTestContext({
        messageHistory: []
      })
      const config = createTestConfig({
        _nodeId: 'inject-1',
        staticUserMessage: 'Original question',
        staticAssistantMessage: 'Original answer',
        injectionMode: 'append',
      })

      // First run
      const result1 = await injectMessagesNode(context, undefined, {}, config)
      expect(result1.context?.messageHistory).toHaveLength(2)

      // Second run with updated content
      const updatedConfig = {
        ...config,
        staticUserMessage: 'Updated question',
        staticAssistantMessage: 'Updated answer',
      }
      const result2 = await injectMessagesNode(result1.context!, undefined, {}, updatedConfig)

      // Should still have only 2 messages (updated in place)
      expect(result2.context?.messageHistory).toHaveLength(2)
      expect(result2.context?.messageHistory[0].content).toBe('Updated question')
      expect(result2.context?.messageHistory[1].content).toBe('Updated answer')
    })

    it('should update messages in place when run twice (prepend mode)', async () => {
      const context = createTestContext({
        messageHistory: [
          { role: 'user', content: 'Existing message' },
        ]
      })
      const config = createTestConfig({
        _nodeId: 'inject-2',
        staticUserMessage: 'Original question',
        staticAssistantMessage: 'Original answer',
        injectionMode: 'prepend',
      })

      // First run
      const result1 = await injectMessagesNode(context, undefined, {}, config)
      expect(result1.context?.messageHistory).toHaveLength(3)

      // Second run with updated content
      const updatedConfig = {
        ...config,
        staticUserMessage: 'Updated question',
        staticAssistantMessage: 'Updated answer',
      }
      const result2 = await injectMessagesNode(result1.context!, undefined, {}, updatedConfig)

      // Should still have 3 messages (injected pair updated in place)
      expect(result2.context?.messageHistory).toHaveLength(3)
      expect(result2.context?.messageHistory[0].content).toBe('Updated question')
      expect(result2.context?.messageHistory[1].content).toBe('Updated answer')
      expect(result2.context?.messageHistory[2].content).toBe('Existing message')
    })
  })

  describe('Metadata assignment', () => {
    it('should auto-generate IDs based on node ID', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        _nodeId: 'my-inject-node',
        staticUserMessage: 'Question',
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.context?.messageHistory[0].metadata?.id).toBe('my-inject-node-user')
      expect(result.context?.messageHistory[1].metadata?.id).toBe('my-inject-node-assistant')
    })

    it('should set pinned and priority metadata', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Question',
        staticAssistantMessage: 'Answer',
        pinned: true,
        priority: 100,
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.context?.messageHistory[0].metadata?.pinned).toBe(true)
      expect(result.context?.messageHistory[0].metadata?.priority).toBe(100)
      expect(result.context?.messageHistory[1].metadata?.pinned).toBe(true)
      expect(result.context?.messageHistory[1].metadata?.priority).toBe(100)
    })

    it('should default pinned to false and priority to 50', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Question',
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.context?.messageHistory[0].metadata?.pinned).toBe(false)
      expect(result.context?.messageHistory[0].metadata?.priority).toBe(50)
    })
  })

  describe('Dynamic inputs', () => {
    it('should use dynamic inputs over static config', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Static question',
        staticAssistantMessage: 'Static answer',
      })
      const inputs = {
        userMessage: 'Dynamic question',
        assistantMessage: 'Dynamic answer',
      }

      const result = await injectMessagesNode(context, undefined, inputs, config)

      expect(result.context?.messageHistory[0].content).toBe('Dynamic question')
      expect(result.context?.messageHistory[1].content).toBe('Dynamic answer')
    })

    it('should fall back to static config if dynamic inputs not provided', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Static question',
        staticAssistantMessage: 'Static answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.context?.messageHistory[0].content).toBe('Static question')
      expect(result.context?.messageHistory[1].content).toBe('Static answer')
    })
  })

  describe('Validation', () => {
    it('should error if user message is missing', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('error')
      expect(result.error).toContain('required')
    })

    it('should error if assistant message is missing', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Question',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('error')
      expect(result.error).toContain('required')
    })

    it('should error if user message is empty string', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: '',
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('error')
    })

    it('should error if user message is whitespace only', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: '   ',
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.status).toBe('error')
    })
  })

  describe('Data output', () => {
    it('should return injected messages in data field', async () => {
      const context = createTestContext({ messageHistory: [] })
      const config = createTestConfig({
        staticUserMessage: 'Question',
        staticAssistantMessage: 'Answer',
      })

      const result = await injectMessagesNode(context, undefined, {}, config)

      expect(result.data).toEqual({
        userMessage: 'Question',
        assistantMessage: 'Answer',
      })
    })
  })
})

