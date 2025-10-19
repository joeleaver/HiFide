/**
 * Intent Router Node Tests
 *
 * Tests the intentRouter node which classifies user input into configured intents
 * and routes the flow accordingly.
 */

import { intentRouterNode } from '../intentRouter'
import {
  createMainFlowContext,
  createTestConfig,
  getTestApiKey,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../../__tests__/utils/testHelpers'
import { withFixture, getTestMode } from '../../../../__tests__/utils/fixtures'

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

describe('Intent Router Node', () => {
  const testMode = getTestMode()
  
  beforeAll(() => {
    console.log(`\n🧪 Running intent router tests in ${testMode.toUpperCase()} mode\n`)
  })

  describe('Basic Intent Classification', () => {
    it('should classify a greeting intent', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })

      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          greeting: 'User is greeting or saying hello',
          question: 'User is asking a question',
          command: 'User is giving a command or instruction'
        }
      })

      const message = 'Hello! How are you today?'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-greeting',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['greeting-context']).toBeDefined()
      expect(result['greeting-data']).toBe(message)
      expect(result['question-context']).toBeUndefined()
      expect(result['command-context']).toBeUndefined()
    })

    it('should classify a question intent', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })

      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          greeting: 'User is greeting or saying hello',
          question: 'User is asking a question',
          command: 'User is giving a command or instruction'
        }
      })

      const message = 'What is the capital of France?'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-question',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['question-context']).toBeDefined()
      expect(result['question-data']).toBe(message)
      expect(result['greeting-context']).toBeUndefined()
      expect(result['command-context']).toBeUndefined()
    })

    it('should classify a command intent', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })

      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          greeting: 'User is greeting or saying hello',
          question: 'User is asking a question',
          command: 'User is giving a command or instruction'
        }
      })

      const message = 'Please create a new file called test.txt'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-command',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['command-context']).toBeDefined()
      expect(result['command-data']).toBe(message)
      expect(result['greeting-context']).toBeUndefined()
      expect(result['question-context']).toBeUndefined()
    })
  })

  describe('Different Providers', () => {
    it('should work with Gemini', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      })

      const config = createTestConfig({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        routes: {
          positive: 'User is expressing positive sentiment',
          negative: 'User is expressing negative sentiment',
          neutral: 'User is expressing neutral sentiment'
        }
      })

      const message = 'This is amazing! I love it!'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-gemini-positive',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['positive-context']).toBeDefined()
      expect(result['positive-data']).toBe(message)
    })
  })

  describe('Edge Cases', () => {
    it('should handle binary classification', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })

      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          yes: 'User is agreeing or saying yes',
          no: 'User is disagreeing or saying no'
        }
      })

      const message = 'Yes, that sounds good'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-binary-yes',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['yes-context']).toBeDefined()
      expect(result['yes-data']).toBe(message)
      expect(result['no-context']).toBeUndefined()
    })

    it('should handle many intents', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })

      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          weather: 'User is asking about weather',
          time: 'User is asking about time',
          location: 'User is asking about location',
          person: 'User is asking about a person',
          thing: 'User is asking about an object or thing',
          other: 'User is asking about something else'
        }
      })

      const message = 'What time is it?'
      const inputs = createMockNodeInputs()

      const result = await withFixture(
        'intent-router-many-intents',
        async () => {
          return await intentRouterNode(flow, context, message, inputs, config)
        }
      )

      expect(result.status).toBe('success')
      expect(result['time-context']).toBeDefined()
      expect(result['time-data']).toBe(message)
    })
  })

  describe('Error Handling', () => {
    it('should throw error when message is missing', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        routes: {
          greeting: 'User is greeting',
          question: 'User is asking a question'
        }
      })
      const inputs = createMockNodeInputs()

      await expect(
        intentRouterNode(flow, context, '', inputs, config)
      ).rejects.toThrow('intentRouter node requires data input')
    })

    it('should throw error when routes are missing', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        provider: 'openai',
        model: 'gpt-4o-mini'
      })
      const inputs = createMockNodeInputs()

      await expect(
        intentRouterNode(flow, context, 'Hello', inputs, config)
      ).rejects.toThrow('intentRouter node requires at least one intent')
    })

    it('should throw error when provider is missing', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        model: 'gpt-4o-mini',
        routes: {
          greeting: 'User is greeting'
        }
      })
      const inputs = createMockNodeInputs()

      await expect(
        intentRouterNode(flow, context, 'Hello', inputs, config)
      ).rejects.toThrow('intentRouter node requires provider and model')
    })

    it('should throw error when model is missing', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        provider: 'openai',
        routes: {
          greeting: 'User is greeting'
        }
      })
      const inputs = createMockNodeInputs()

      await expect(
        intentRouterNode(flow, context, 'Hello', inputs, config)
      ).rejects.toThrow('intentRouter node requires provider and model')
    })
  })
})

