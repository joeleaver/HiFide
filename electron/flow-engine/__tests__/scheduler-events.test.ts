/**
 * Scheduler Event Handling Tests
 * 
 * Tests that the scheduler correctly routes execution events to store handlers.
 */

import type { ExecutionEvent } from '../execution-events'

describe('Scheduler Event Handling', () => {
  // Mock store with tracking
  let mockStore: any
  let storeCallHistory: Array<{ method: string; args: any[] }>

  beforeEach(() => {
    storeCallHistory = []
    
    mockStore = {
      feHandleChunk: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleChunk', args })
      }),
      feHandleToolStart: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleToolStart', args })
      }),
      feHandleToolEnd: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleToolEnd', args })
      }),
      feHandleToolError: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleToolError', args })
      }),
      feHandleTokenUsage: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleTokenUsage', args })
      }),
      feHandleDone: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleDone', args })
      }),
      feHandleError: jest.fn((...args) => {
        storeCallHistory.push({ method: 'feHandleError', args })
      })
    }
  })

  // Helper to simulate scheduler's handleExecutionEvent
  async function handleExecutionEvent(event: ExecutionEvent): Promise<void> {
    const store = mockStore

    switch (event.type) {
      case 'chunk':
        if (event.chunk) {
          store.feHandleChunk(event.chunk, event.nodeId, event.provider, event.model)
        }
        break

      case 'tool_start':
        if (event.tool) {
          store.feHandleToolStart(
            event.tool.toolName,
            event.nodeId,
            event.tool.toolArgs,
            event.tool.toolCallId,
            event.provider,
            event.model
          )
        }
        break

      case 'tool_end':
        if (event.tool) {
          store.feHandleToolEnd(event.tool.toolName, event.tool.toolCallId, event.nodeId)
        }
        break

      case 'tool_error':
        if (event.tool) {
          store.feHandleToolError(
            event.tool.toolName,
            event.tool.toolError || 'Unknown error',
            event.tool.toolCallId,
            event.nodeId
          )
        }
        break

      case 'usage':
        if (event.usage) {
          store.feHandleTokenUsage(event.provider, event.model, {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens
          })
        }
        break

      case 'done':
        store.feHandleDone()
        break

      case 'error':
        if (event.error) {
          store.feHandleError(event.error, event.nodeId, event.provider, event.model)
        }
        break
    }
  }

  describe('Chunk Event Routing', () => {
    it('should route chunk events to feHandleChunk', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'chunk',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        chunk: 'Hello, World!'
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleChunk).toHaveBeenCalledWith(
        'Hello, World!',
        'node-456',
        'anthropic',
        'claude-haiku-4-5'
      )
      expect(storeCallHistory).toHaveLength(1)
    })

    it('should handle multiple chunk events in order', async () => {
      const chunks = ['Hello', ', ', 'World', '!']
      
      for (const chunk of chunks) {
        await handleExecutionEvent({
          executionId: 'exec-123',
          nodeId: 'node-456',
          timestamp: Date.now(),
          type: 'chunk',
          provider: 'openai',
          model: 'gpt-4o-mini',
          chunk
        })
      }

      expect(mockStore.feHandleChunk).toHaveBeenCalledTimes(4)
      expect(storeCallHistory.map(c => c.args[0])).toEqual(chunks)
    })
  })

  describe('Tool Event Routing', () => {
    it('should route tool_start events to feHandleToolStart', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'tool_start',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolArgs: { path: 'test.txt' }
        }
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleToolStart).toHaveBeenCalledWith(
        'read_file',
        'node-456',
        { path: 'test.txt' },
        'call-123',
        'anthropic',
        'claude-haiku-4-5'
      )
    })

    it('should route tool_end events to feHandleToolEnd', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'tool_end',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolResult: { content: 'file contents' }
        }
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleToolEnd).toHaveBeenCalledWith(
        'read_file',
        'call-123',
        'node-456'
      )
    })

    it('should route tool_error events to feHandleToolError', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'tool_error',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolError: 'File not found'
        }
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleToolError).toHaveBeenCalledWith(
        'read_file',
        'File not found',
        'call-123',
        'node-456'
      )
    })

    it('should handle complete tool lifecycle', async () => {
      // tool_start
      await handleExecutionEvent({
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'tool_start',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolArgs: { path: 'test.txt' }
        }
      })

      // tool_end
      await handleExecutionEvent({
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'tool_end',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolResult: { content: 'file contents' }
        }
      })

      expect(storeCallHistory).toHaveLength(2)
      expect(storeCallHistory[0].method).toBe('feHandleToolStart')
      expect(storeCallHistory[1].method).toBe('feHandleToolEnd')
    })
  })

  describe('Usage Event Routing', () => {
    it('should route usage events to feHandleTokenUsage', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'usage',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        }
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleTokenUsage).toHaveBeenCalledWith(
        'openai',
        'gpt-4o-mini',
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        }
      )
    })
  })

  describe('Done Event Routing', () => {
    it('should route done events to feHandleDone', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'done',
        provider: 'anthropic',
        model: 'claude-haiku-4-5'
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleDone).toHaveBeenCalled()
    })
  })

  describe('Error Event Routing', () => {
    it('should route error events to feHandleError', async () => {
      const event: ExecutionEvent = {
        executionId: 'exec-123',
        nodeId: 'node-456',
        timestamp: Date.now(),
        type: 'error',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        error: 'API rate limit exceeded'
      }

      await handleExecutionEvent(event)

      expect(mockStore.feHandleError).toHaveBeenCalledWith('API rate limit exceeded', 'node-456', 'gemini', 'gemini-2.0-flash-exp')
    })
  })

  describe('Complete Event Flow', () => {
    it('should handle a complete LLM request flow', async () => {
      // Simulate a complete flow: chunks → usage → done
      const events: ExecutionEvent[] = [
        {
          executionId: 'exec-123',
          nodeId: 'node-456',
          timestamp: Date.now(),
          type: 'chunk',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          chunk: 'Hello'
        },
        {
          executionId: 'exec-123',
          nodeId: 'node-456',
          timestamp: Date.now(),
          type: 'chunk',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          chunk: ', World!'
        },
        {
          executionId: 'exec-123',
          nodeId: 'node-456',
          timestamp: Date.now(),
          type: 'usage',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
        },
        {
          executionId: 'exec-123',
          nodeId: 'node-456',
          timestamp: Date.now(),
          type: 'done',
          provider: 'anthropic',
          model: 'claude-haiku-4-5'
        }
      ]

      for (const event of events) {
        await handleExecutionEvent(event)
      }

      expect(storeCallHistory).toHaveLength(4)
      expect(storeCallHistory[0].method).toBe('feHandleChunk')
      expect(storeCallHistory[1].method).toBe('feHandleChunk')
      expect(storeCallHistory[2].method).toBe('feHandleTokenUsage')
      expect(storeCallHistory[3].method).toBe('feHandleDone')
    })
  })
})

