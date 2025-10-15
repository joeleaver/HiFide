/**
 * Test helper utilities for creating test contexts, configs, and mocks
 */

import type { ExecutionContext } from '../../ipc/flows-v2/types'
import type { ProviderAdapter, ChatMessage, AgentTool } from '../../providers/provider'
import { withFixture, getTestMode } from './fixtures'

/**
 * Create a test execution context with sensible defaults
 */
export function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    systemInstructions: 'You are a helpful assistant.',
    messageHistory: [],
    currentOutput: '',
    sessionId: 'test-session-' + Date.now(),
    ...overrides
  }
}

/**
 * Create a test node config
 */
export function createTestConfig(overrides?: Record<string, any>): Record<string, any> {
  return {
    _nodeId: 'test-node',
    ...overrides
  }
}

/**
 * Create a simple test tool
 */
export function createTestTool(name: string = 'test_tool'): AgentTool {
  return {
    name,
    description: `A test tool named ${name}`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Test input' }
      },
      required: ['input']
    },
    run: async (input: any) => {
      return { result: `Tool ${name} executed with: ${JSON.stringify(input)}` }
    }
  }
}

/**
 * Get API key for testing
 * Reads from environment variable or throws helpful error
 */
export function getTestApiKey(provider: 'anthropic' | 'openai' | 'gemini'): string {
  const envVars = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY'
  }
  
  const envVar = envVars[provider]
  const apiKey = process.env[envVar]
  
  if (!apiKey && getTestMode() !== 'replay') {
    throw new Error(
      `Missing API key for ${provider}.\n` +
      `Set ${envVar} environment variable or run tests in replay mode (TEST_MODE=replay).`
    )
  }
  
  return apiKey || 'mock-api-key-for-replay'
}

/**
 * Create a mock provider adapter for testing
 * Useful for testing nodes without making real API calls
 */
export function createMockProvider(
  responses: string[] = ['Mock response']
): ProviderAdapter {
  let responseIndex = 0
  
  return {
    id: 'mock',
    
    async chatStream({ onChunk, onDone, onError, onTokenUsage }) {
      try {
        const response = responses[responseIndex % responses.length]
        responseIndex++
        
        // Simulate streaming by chunking the response
        const chunkSize = 10
        for (let i = 0; i < response.length; i += chunkSize) {
          const chunk = response.slice(i, i + chunkSize)
          onChunk(chunk)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        
        // Simulate token usage
        if (onTokenUsage) {
          onTokenUsage({
            inputTokens: 10,
            outputTokens: response.length / 4,
            totalTokens: 10 + response.length / 4
          })
        }
        
        onDone()
      } catch (e: any) {
        onError(e.message)
      }
      
      return { cancel: () => {} }
    },
    
    async agentStream({ onChunk, onDone, onError, onTokenUsage, tools }) {
      // For mock, just use chatStream behavior
      return this.chatStream!({ 
        apiKey: 'mock',
        model: 'mock',
        messages: [],
        onChunk, 
        onDone, 
        onError, 
        onTokenUsage 
      })
    }
  }
}

/**
 * Wait for a condition to be true
 * Useful for async testing
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Collect chunks from a streaming response
 */
export async function collectStreamChunks(
  streamFn: (onChunk: (text: string) => void) => Promise<void>
): Promise<string> {
  let result = ''
  
  await streamFn((chunk) => {
    result += chunk
  })
  
  return result
}

