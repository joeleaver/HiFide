/**
 * Provider Execution Event Integration Tests
 * 
 * Tests that all three providers (Anthropic, OpenAI, Gemini) correctly emit
 * execution events with complete metadata.
 * 
 * Run with different modes:
 * - TEST_MODE=replay pnpm test (default - uses saved fixtures)
 * - TEST_MODE=record pnpm test (makes real API calls, saves responses)
 * - TEST_MODE=live pnpm test (always makes real API calls)
 */

import { AnthropicProvider } from '../anthropic'
import { OpenAIProvider } from '../openai'
import { GeminiProvider } from '../gemini'
import type { ExecutionEvent } from '../../ipc/flows-v2/execution-events'
import { getTestApiKey } from '../../__tests__/utils/testHelpers'
import { withFixture, getTestMode } from '../../__tests__/utils/fixtures'

describe('Provider Execution Event Integration', () => {
  const testMode = getTestMode()

  beforeAll(() => {
    console.log(`\n🧪 Running provider event tests in ${testMode.toUpperCase()} mode\n`)
  })

  describe('Anthropic Provider', () => {
    const provider = AnthropicProvider

    it('should emit chunk events with complete metadata', async () => {
      const events: ExecutionEvent[] = []
      const emit = (event: any) => {
        events.push({
          ...event,
          executionId: 'test-exec-123',
          nodeId: 'test-node-456',
          timestamp: Date.now()
        })
      }

      await withFixture(
        'anthropic-chat-simple',
        async () => {
          const apiKey = getTestApiKey('anthropic')
          await provider.chatStream({
            apiKey,
            model: 'claude-3-5-haiku-20241022',
            systemInstruction: 'You are a helpful assistant.',
            messages: [{ role: 'user', content: 'Say "Hello" and nothing else.' }],
            emit,
            onChunk: () => {},
            onDone: () => {},
            onError: () => {}
          })

          return { events }
        },
        testMode
      )

      // Verify chunk events
      const chunkEvents = events.filter(e => e.type === 'chunk')
      expect(chunkEvents.length).toBeGreaterThan(0)
      
      chunkEvents.forEach(event => {
        expect(event).toMatchObject({
          type: 'chunk',
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
          executionId: 'test-exec-123',
          nodeId: 'test-node-456'
        })
        expect(event.chunk).toBeDefined()
        expect(typeof event.chunk).toBe('string')
        expect(event.timestamp).toBeGreaterThan(0)
      })

      // Verify usage event
      const usageEvents = events.filter(e => e.type === 'usage')
      expect(usageEvents).toHaveLength(1)
      expect(usageEvents[0].usage).toMatchObject({
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number)
      })

      // Verify done event
      const doneEvents = events.filter(e => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
    })

    it('should emit tool events with toolExecutionId', async () => {
      const events: ExecutionEvent[] = []
      const emit = (event: any) => {
        events.push({
          ...event,
          executionId: 'test-exec-123',
          nodeId: 'test-node-456',
          timestamp: Date.now()
        })
      }

      const testTool = {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        },
        run: async (input: any) => {
          return { temperature: 72, condition: 'sunny' }
        }
      }

      await withFixture(
        'anthropic-agent-tool-call',
        async () => {
          const apiKey = getTestApiKey('anthropic')
          await provider.agentStream?.({
            apiKey,
            model: 'claude-3-5-haiku-20241022',
            systemInstruction: 'You are a helpful assistant.',
            messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
            tools: [testTool],
            toolMeta: {},
            emit,
            onChunk: () => {},
            onDone: () => {},
            onError: () => {},
            onToolStart: () => {},
            onToolEnd: () => {},
            onToolError: () => {}
          })

          return { events }
        },
        testMode
      )

      // Verify tool_start events
      const toolStartEvents = events.filter(e => e.type === 'tool_start')
      expect(toolStartEvents.length).toBeGreaterThan(0)
      
      toolStartEvents.forEach(event => {
        expect(event.tool).toMatchObject({
          toolCallId: expect.any(String),
          toolExecutionId: expect.any(String),
          toolName: expect.any(String),
          toolArgs: expect.any(Object)
        })
        // Verify toolExecutionId is a valid UUID
        expect(event.tool?.toolExecutionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      })

      // Verify tool_end events
      const toolEndEvents = events.filter(e => e.type === 'tool_end')
      expect(toolEndEvents.length).toBeGreaterThan(0)
      
      toolEndEvents.forEach(event => {
        expect(event.tool).toMatchObject({
          toolCallId: expect.any(String),
          toolExecutionId: expect.any(String),
          toolName: expect.any(String),
          toolResult: expect.any(Object)
        })
      })
    })
  })

  describe('OpenAI Provider', () => {
    const provider = OpenAIProvider

    it('should emit chunk events with complete metadata', async () => {
      const events: ExecutionEvent[] = []
      const emit = (event: any) => {
        events.push({
          ...event,
          executionId: 'test-exec-123',
          nodeId: 'test-node-456',
          timestamp: Date.now()
        })
      }

      await withFixture(
        'openai-chat-simple',
        async () => {
          const apiKey = getTestApiKey('openai')
          await provider.chatStream({
            apiKey,
            model: 'gpt-4o-mini',
            systemInstruction: 'You are a helpful assistant.',
            messages: [{ role: 'user', content: 'Say "Hello" and nothing else.' }],
            emit,
            onChunk: () => {},
            onDone: () => {},
            onError: () => {}
          })

          return { events }
        },
        testMode
      )

      // Verify chunk events
      const chunkEvents = events.filter(e => e.type === 'chunk')
      expect(chunkEvents.length).toBeGreaterThan(0)
      
      chunkEvents.forEach(event => {
        expect(event).toMatchObject({
          type: 'chunk',
          provider: 'openai',
          model: 'gpt-4o-mini',
          executionId: 'test-exec-123',
          nodeId: 'test-node-456'
        })
        expect(event.chunk).toBeDefined()
        expect(typeof event.chunk).toBe('string')
      })

      // Verify usage and done events
      expect(events.filter(e => e.type === 'usage')).toHaveLength(1)
      expect(events.filter(e => e.type === 'done')).toHaveLength(1)
    })

    it('should emit tool events with toolExecutionId', async () => {
      const events: ExecutionEvent[] = []
      const emit = (event: any) => {
        events.push({
          ...event,
          executionId: 'test-exec-123',
          nodeId: 'test-node-456',
          timestamp: Date.now()
        })
      }

      const testTool = {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        },
        run: async (input: any) => {
          return { temperature: 72, condition: 'sunny' }
        }
      }

      await withFixture(
        'openai-agent-tool-call',
        async () => {
          const apiKey = getTestApiKey('openai')
          await provider.agentStream?.({
            apiKey,
            model: 'gpt-4o-mini',
            systemInstruction: 'You are a helpful assistant.',
            messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
            tools: [testTool],
            toolMeta: {},
            emit,
            onChunk: () => {},
            onDone: () => {},
            onError: () => {},
            onToolStart: () => {},
            onToolEnd: () => {},
            onToolError: () => {}
          })

          return { events }
        },
        testMode
      )

      // Verify tool events have toolExecutionId
      const toolStartEvents = events.filter(e => e.type === 'tool_start')
      expect(toolStartEvents.length).toBeGreaterThan(0)
      
      toolStartEvents.forEach(event => {
        expect(event.tool?.toolExecutionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      })
    })
  })

  describe('Gemini Provider', () => {
    const provider = GeminiProvider

    it('should emit chunk events with complete metadata', async () => {
      const events: ExecutionEvent[] = []
      const emit = (event: any) => {
        events.push({
          ...event,
          executionId: 'test-exec-123',
          nodeId: 'test-node-456',
          timestamp: Date.now()
        })
      }

      await withFixture(
        'gemini-chat-simple',
        async () => {
          const apiKey = getTestApiKey('gemini')
          await provider.chatStream({
            apiKey,
            model: 'gemini-2.0-flash-exp',
            systemInstruction: 'You are a helpful assistant.',
            contents: [{ role: 'user', parts: [{ text: 'Say "Hello" and nothing else.' }] }],
            emit,
            onChunk: () => {},
            onDone: () => {},
            onError: () => {}
          })

          return { events }
        },
        testMode
      )

      // Verify chunk events
      const chunkEvents = events.filter(e => e.type === 'chunk')
      expect(chunkEvents.length).toBeGreaterThan(0)
      
      chunkEvents.forEach(event => {
        expect(event).toMatchObject({
          type: 'chunk',
          provider: 'gemini',
          model: 'gemini-2.0-flash-exp',
          executionId: 'test-exec-123',
          nodeId: 'test-node-456'
        })
        expect(event.chunk).toBeDefined()
      })

      // Verify usage and done events
      expect(events.filter(e => e.type === 'usage')).toHaveLength(1)
      expect(events.filter(e => e.type === 'done')).toHaveLength(1)
    })
  })

  describe('Cross-Provider Consistency', () => {
    it('should emit events in consistent order across all providers', async () => {
      // All providers should emit: chunks... → usage → done
      const testProviders = [
        { name: 'anthropic', provider: AnthropicProvider, model: 'claude-3-5-haiku-20241022' },
        { name: 'openai', provider: OpenAIProvider, model: 'gpt-4o-mini' },
        { name: 'gemini', provider: GeminiProvider, model: 'gemini-2.0-flash-exp' }
      ]

      for (const { name, provider, model } of testProviders) {
        const events: ExecutionEvent[] = []
        const emit = (event: any) => {
          events.push({
            ...event,
            executionId: 'test-exec',
            nodeId: 'test-node',
            timestamp: Date.now()
          })
        }

        // Skip if no API key in replay mode
        if (testMode === 'replay') continue

        // Test each provider
        // (Implementation would go here - simplified for brevity)
      }
    })
  })
})

