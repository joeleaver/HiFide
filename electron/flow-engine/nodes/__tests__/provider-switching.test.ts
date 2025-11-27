/**
 * Provider Switching Tests
 *
 * Tests that conversation context is preserved when switching between providers mid-flow.
 */

import { llmRequestNode } from '../llmRequest'
import type { ExecutionContext } from '../../types'
import { createTestContext, createTestConfig, getTestApiKey } from '../../../../__tests__/utils/testHelpers'
import { withFixture, getTestMode } from '../../../../__tests__/utils/fixtures'

// Mock the state module to provide API keys
jest.mock('../../../../core/state', () => ({
  providers: {
    anthropic: require('../../../../providers-ai-sdk/anthropic').AnthropicAiSdkProvider,
    openai: require('../../../../providers-ai-sdk/openai').OpenAiSdkProvider,
    gemini: require('../../../../providers-ai-sdk/gemini').GeminiAiSdkProvider,
  },
  getProviderKey: jest.fn(async (provider: string) => {
    return getTestApiKey(provider as any)
  })
}))

// Mock sendFlowEvent since we don't have WebContents in tests
jest.mock('../../events', () => ({
  sendFlowEvent: jest.fn()
}))

describe('Provider Switching', () => {
  const testMode = getTestMode()
  
  beforeAll(() => {
    console.log(`\n🧪 Running provider switching tests in ${testMode.toUpperCase()} mode\n`)
  })

  describe('Context Persistence', () => {
    it('should preserve context when switching from OpenAI to Gemini', async () => {
      // Start with OpenAI
      const context1 = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const config = createTestConfig()

      // First message with OpenAI
      const message1 = 'Remember this secret word: BANANA. Just say "OK" and nothing else.'

      const result1 = await withFixture(
        'provider-switch-openai-to-gemini-msg1-v2',
        async () => {
          return await llmRequestNode(context1, message1, {}, config)
        }
      )

      expect(result1.status).toBe('success')
      expect(result1.context.messageHistory).toHaveLength(2) // user + assistant
      expect(result1.context.provider).toBe('openai')

      // Switch to Gemini - simulate what the scheduler does
      const context2: ExecutionContext = {
        ...result1.context,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      }

      // Second message with Gemini - ask about the secret word
      const message2 = 'What was the secret word I told you to remember? Just say the word and nothing else.'

      const result2 = await withFixture(
        'provider-switch-openai-to-gemini-msg2-v2',
        async () => {
          return await llmRequestNode(context2, message2, {}, config)
        }
      )

      expect(result2.status).toBe('success')
      expect(result2.context.messageHistory).toHaveLength(4) // 2 previous + 2 new
      expect(result2.context.provider).toBe('gemini')

      // Verify Gemini remembered the secret word from OpenAI conversation
      if (testMode !== 'replay') {
        const response = result2.data as string
        expect(response.toUpperCase()).toContain('BANANA')
      }
    })



    it('should preserve context when switching from Gemini to OpenAI', async () => {
      // Start with Gemini
      const context1 = createTestContext({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      })
      const config = createTestConfig()
      
      // First message with Gemini
      const message1 = 'The capital of France is Paris. Just say "Noted" and nothing else.'
      
      const result1 = await withFixture(
        'provider-switch-gemini-to-openai-msg1',
        async () => {
          return await llmRequestNode(context1, message1, {}, config)
        }
      )
      
      expect(result1.status).toBe('success')
      expect(result1.context.messageHistory).toHaveLength(2)
      
      // Switch to OpenAI
      const context2: ExecutionContext = {
        ...result1.context,
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
      
      // Second message with OpenAI - ask about the capital
      const message2 = 'What did I say the capital of France is? Just say the city name and nothing else.'
      
      const result2 = await withFixture(
        'provider-switch-gemini-to-openai-msg2',
        async () => {
          return await llmRequestNode(context2, message2, {}, config)
        }
      )
      
      expect(result2.status).toBe('success')
      expect(result2.context.messageHistory).toHaveLength(4)
      expect(result2.context.provider).toBe('openai')
      
      // Verify OpenAI remembered the capital from Gemini conversation
      if (testMode !== 'replay') {
        const response = result2.data as string
        expect(response.toLowerCase()).toContain('paris')
      }
    })

    it('should preserve context through multiple provider switches', async () => {
      // Message 1: OpenAI
      const context1 = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const config = createTestConfig()

      const result1 = await withFixture(
        'provider-switch-multi-msg1',
        async () => {
          return await llmRequestNode(context1, 'Count: 1. Just say "OK" and nothing else.', {}, config)
        }
      )

      expect(result1.status).toBe('success')

      // Message 2: Switch to Gemini
      const context2: ExecutionContext = {
        ...result1.context,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      }

      const result2 = await withFixture(
        'provider-switch-multi-msg2',
        async () => {
          return await llmRequestNode(context2, 'Count: 2. Just say "OK" and nothing else.', {}, config)
        }
      )

      expect(result2.status).toBe('success')

      // Message 3: Switch back to OpenAI - ask about all counts
      const context3: ExecutionContext = {
        ...result2.context,
        provider: 'openai',
        model: 'gpt-4o-mini'
      }

      const result3 = await withFixture(
        'provider-switch-multi-msg3',
        async () => {
          return await llmRequestNode(
            context3,
            'What were all the count numbers I mentioned? List them separated by commas and nothing else.',
            {},
            config
          )
        }
      )

      expect(result3.status).toBe('success')
      expect(result3.context.messageHistory).toHaveLength(6) // 3 exchanges = 6 messages

      // Verify OpenAI remembered all counts from all providers
      if (testMode !== 'replay') {
        const response = result3.data as string
        expect(response).toContain('1')
        expect(response).toContain('2')
      }
    })
  })

  describe('Message History Integrity', () => {
    it('should maintain correct message history length after switching', async () => {
      const context1 = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const config = createTestConfig()
      
      const result1 = await withFixture(
        'provider-switch-history-msg1',
        async () => {
          return await llmRequestNode(context1, 'First message', {}, config)
        }
      )
      
      expect(result1.context.messageHistory).toHaveLength(2)
      
      // Switch provider
      const context2: ExecutionContext = {
        ...result1.context,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      }
      
      const result2 = await withFixture(
        'provider-switch-history-msg2',
        async () => {
          return await llmRequestNode(context2, 'Second message', {}, config)
        }
      )
      
      expect(result2.context.messageHistory).toHaveLength(4)
      
      // Verify message history structure
      expect(result2.context.messageHistory[0].role).toBe('user')
      expect(result2.context.messageHistory[0].content).toBe('First message')
      expect(result2.context.messageHistory[1].role).toBe('assistant')
      expect(result2.context.messageHistory[2].role).toBe('user')
      expect(result2.context.messageHistory[2].content).toBe('Second message')
      expect(result2.context.messageHistory[3].role).toBe('assistant')
    })

    it('should preserve system instructions across provider switches', async () => {
      const systemInstructions = 'You are a helpful assistant. Always be concise.'

      const context1 = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemInstructions
      })
      const config = createTestConfig()

      const result1 = await withFixture(
        'provider-switch-system-msg1',
        async () => {
          return await llmRequestNode(context1, 'Hello', {}, config)
        }
      )

      expect(result1.status).toBe('success')
      expect(result1.context.systemInstructions).toBe(systemInstructions)

      // Switch provider to Gemini
      const context2: ExecutionContext = {
        ...result1.context,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      }

      const result2 = await withFixture(
        'provider-switch-system-msg2',
        async () => {
          return await llmRequestNode(context2, 'Hi again', {}, config)
        }
      )

      expect(result2.status).toBe('success')
      expect(result2.context.systemInstructions).toBe(systemInstructions)
    })
  })

  // Note: Session ID tests removed - providers are now stateless
  // The scheduler manages all conversation state via MainFlowContext.messageHistory
})

