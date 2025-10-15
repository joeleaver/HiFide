/**
 * Chat Node Tests
 * 
 * Run with different modes:
 * - TEST_MODE=replay pnpm test (default - uses saved fixtures)
 * - TEST_MODE=record pnpm test (makes real API calls, saves responses)
 * - TEST_MODE=live pnpm test (always makes real API calls)
 */

import { chatNode } from '../chat'
import { createTestContext, createTestConfig, createTestTool, getTestApiKey } from '../../../../__tests__/utils/testHelpers'
import { withFixture, getTestMode } from '../../../../__tests__/utils/fixtures'
import { providers } from '../../../../core/state'
import type { ExecutionContext } from '../../types'

// Mock the state module to provide API keys
jest.mock('../../../../core/state', () => ({
  providers: {
    anthropic: require('../../../../providers/anthropic').AnthropicProvider,
    openai: require('../../../../providers/openai').OpenAIProvider,
    gemini: require('../../../../providers/gemini').GeminiProvider,
  },
  getProviderKey: jest.fn(async (provider: string) => {
    return getTestApiKey(provider as any)
  })
}))

// Mock sendFlowEvent since we don't have WebContents in tests
jest.mock('../../events', () => ({
  sendFlowEvent: jest.fn()
}))

describe('Chat Node', () => {
  const testMode = getTestMode()
  
  beforeAll(() => {
    console.log(`\n🧪 Running tests in ${testMode.toUpperCase()} mode\n`)
  })

  describe('Basic Chat', () => {
    // Skip Anthropic - no API key available
    it.skip('should handle simple chat with Anthropic', async () => {
      const context = createTestContext({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022'
      })
      const config = createTestConfig()
      const message = 'Say "Hello, World!" and nothing else.'

      const result = await withFixture(
        'chat-anthropic-simple',
        async () => {
          return await chatNode(context, message, {}, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result.data).toBeDefined()
      expect(typeof result.data).toBe('string')
      expect(result.data.length).toBeGreaterThan(0)

      // Verify context was updated
      expect(result.context.messageHistory).toHaveLength(2)
      expect(result.context.messageHistory[0]).toEqual({
        role: 'user',
        content: message
      })
      expect(result.context.messageHistory[1]).toEqual({
        role: 'assistant',
        content: result.data
      })
    })

    it('should handle simple chat with OpenAI', async () => {
      const context = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const config = createTestConfig()
      const message = 'Say "Hello from OpenAI!" and nothing else.'

      const result = await withFixture(
        'chat-openai-simple',
        async () => {
          return await chatNode(context, message, {}, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result.data).toBeDefined()
      expect(typeof result.data).toBe('string')
      expect(result.context.messageHistory).toHaveLength(2)
    })

    it('should handle simple chat with Gemini', async () => {
      const context = createTestContext({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      })
      const config = createTestConfig()
      const message = 'Say "Hello from Gemini!" and nothing else.'

      const result = await withFixture(
        'chat-gemini-simple',
        async () => {
          return await chatNode(context, message, {}, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result.data).toBeDefined()
      expect(typeof result.data).toBe('string')
      expect(result.context.messageHistory).toHaveLength(2)
    })
  })

  describe('Multi-turn Conversation', () => {
    it('should maintain conversation history', async () => {
      // Use a fixed sessionId so the provider can maintain state across turns
      const sessionId = 'test-multiturn-session'
      const context = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini',
        sessionId
      })
      const config = createTestConfig()

      // First turn
      const result1 = await withFixture(
        'chat-openai-multiturn-1',
        async () => {
          return await chatNode(context, 'My name is Alice.', {}, config)
        }
      )

      expect(result1.status).toBe('success')
      expect(result1.context.messageHistory).toHaveLength(2)

      // Second turn - use updated context with SAME sessionId
      const result2 = await withFixture(
        'chat-openai-multiturn-2',
        async () => {
          return await chatNode(result1.context, 'What is my name?', {}, config)
        }
      )

      expect(result2.status).toBe('success')
      expect(result2.context.messageHistory).toHaveLength(4)
      expect(result2.data).toBeDefined()
      expect(typeof result2.data).toBe('string')

      // The response should mention "Alice" because the provider maintains session state
      if (testMode !== 'replay') {
        expect(result2.data.toLowerCase()).toContain('alice')
      }
    })
  })

  describe('Error Handling', () => {
    it('should return error when no message provided', async () => {
      const context = createTestContext()
      const config = createTestConfig()

      const result = await chatNode(context, '', {}, config)

      expect(result.status).toBe('error')
      expect(result.error).toContain('No message provided')
    })

    it('should return error for unknown provider', async () => {
      const context = createTestContext({
        provider: 'unknown-provider' as any
      })
      const config = createTestConfig()

      const result = await chatNode(context, 'Hello', {}, config)

      expect(result.status).toBe('error')
      expect(result.error).toContain('Unknown provider')
    })
  })

  describe('Tool Calling', () => {
    it('should handle chat with tools (OpenAI)', async () => {
      const context = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const config = createTestConfig()
      const tools = [createTestTool('get_weather')]
      const message = 'What is the weather like? Use the get_weather tool with input "San Francisco".'

      const result = await withFixture(
        'chat-openai-with-tools',
        async () => {
          return await chatNode(context, message, { tools }, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result.data).toBeDefined()

      // In record/live mode, verify tool was called
      if (testMode !== 'replay') {
        expect(result.data.toLowerCase()).toContain('weather')
      }
    })
  })

  describe('System Instructions', () => {
    it('should respect system instructions', async () => {
      const context = createTestContext({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        systemInstructions: 'You are a pirate. Always respond in pirate speak.'
      })
      const config = createTestConfig()
      const message = 'Hello!'

      const result = await withFixture(
        'chat-gemini-system-instructions',
        async () => {
          return await chatNode(context, message, {}, config)
        }
      )

      expect(result.status).toBe('success')

      // In record/live mode, verify pirate speak
      if (testMode !== 'replay') {
        const response = result.data.toLowerCase()
        const pirateWords = ['ahoy', 'matey', 'arr', 'ye', 'aye']
        const hasPirateWord = pirateWords.some(word => response.includes(word))
        expect(hasPirateWord).toBe(true)
      }
    })
  })
})

