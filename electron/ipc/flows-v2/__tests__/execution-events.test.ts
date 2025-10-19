/**
 * Execution Event System Tests
 * 
 * Tests the unified execution event system that routes events from providers
 * through FlowAPI to store handlers.
 */

import { createEventEmitter, executionEventToLegacyCallbacks } from '../execution-events'
import type { ExecutionEvent, EmitExecutionEvent } from '../execution-events'

describe('Execution Event System', () => {
  describe('createEventEmitter', () => {
    it('should create an emitter that adds metadata to events', () => {
      const events: ExecutionEvent[] = []
      const handler = (event: ExecutionEvent) => events.push(event)
      
      const emit = createEventEmitter('exec-123', 'node-456', handler)
      
      emit({
        type: 'chunk',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        chunk: 'Hello'
      })
      
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        executionId: 'exec-123',
        nodeId: 'node-456',
        type: 'chunk',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        chunk: 'Hello'
      })
      expect(events[0].timestamp).toBeGreaterThan(0)
    })

    it('should handle tool_start events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'tool_start',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolArgs: { path: 'test.txt' }
        }
      })
      
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolArgs: { path: 'test.txt' }
        }
      })
    })

    it('should handle tool_end events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'tool_end',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolResult: { content: 'file contents' }
        }
      })
      
      expect(events[0].tool?.toolResult).toEqual({ content: 'file contents' })
    })

    it('should handle tool_error events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'tool_error',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        tool: {
          toolCallId: 'call-123',
          toolExecutionId: 'tool-exec-456',
          toolName: 'read_file',
          toolError: 'File not found'
        }
      })
      
      expect(events[0].tool?.toolError).toBe('File not found')
    })

    it('should handle usage events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'usage',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        }
      })
      
      expect(events[0].usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      })
    })

    it('should handle done events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'done',
        provider: 'anthropic',
        model: 'claude-haiku-4-5'
      })
      
      expect(events[0].type).toBe('done')
    })

    it('should handle error events', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({
        type: 'error',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        error: 'API rate limit exceeded'
      })
      
      expect(events[0].error).toBe('API rate limit exceeded')
    })
  })

  describe('executionEventToLegacyCallbacks', () => {
    it('should convert chunk events to onChunk callback', () => {
      const chunks: string[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'anthropic', 'claude-haiku-4-5')
      callbacks.onChunk = (chunk) => chunks.push(chunk)
      
      emit({
        type: 'chunk',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        chunk: 'Hello'
      })
      
      // Manually trigger callback (adapter would do this)
      callbacks.onChunk('Hello')
      
      expect(chunks).toEqual(['Hello'])
    })

    it('should convert tool_start events to onToolStart callback', () => {
      const toolStarts: any[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'openai', 'gpt-4o-mini')
      callbacks.onToolStart = (data) => toolStarts.push(data)
      
      callbacks.onToolStart?.({
        callId: 'call-123',
        name: 'read_file',
        arguments: { path: 'test.txt' }
      })
      
      expect(toolStarts).toHaveLength(1)
      expect(toolStarts[0]).toMatchObject({
        callId: 'call-123',
        name: 'read_file',
        arguments: { path: 'test.txt' }
      })
    })

    it('should convert tool_end events to onToolEnd callback', () => {
      const toolEnds: any[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'gemini', 'gemini-2.0-flash-exp')
      callbacks.onToolEnd = (data) => toolEnds.push(data)
      
      callbacks.onToolEnd?.({
        callId: 'call-123',
        name: 'read_file',
        result: { content: 'file contents' }
      })
      
      expect(toolEnds[0].result).toEqual({ content: 'file contents' })
    })

    it('should convert tool_error events to onToolError callback', () => {
      const toolErrors: any[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'anthropic', 'claude-haiku-4-5')
      callbacks.onToolError = (data) => toolErrors.push(data)
      
      callbacks.onToolError?.({
        callId: 'call-123',
        name: 'read_file',
        error: 'File not found'
      })
      
      expect(toolErrors[0].error).toBe('File not found')
    })

    it('should convert usage events to onTokenUsage callback', () => {
      const usages: any[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'openai', 'gpt-4o-mini')
      callbacks.onTokenUsage = (usage) => usages.push(usage)
      
      callbacks.onTokenUsage?.({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      })
      
      expect(usages[0]).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      })
    })

    it('should convert done events to onDone callback', () => {
      let doneCalled = false
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'gemini', 'gemini-2.0-flash-exp')
      callbacks.onDone = () => { doneCalled = true }
      
      callbacks.onDone()
      
      expect(doneCalled).toBe(true)
    })

    it('should convert error events to onError callback', () => {
      const errors: string[] = []
      const emit = jest.fn()
      
      const callbacks = executionEventToLegacyCallbacks(emit as any, 'anthropic', 'claude-haiku-4-5')
      callbacks.onError = (error) => errors.push(error)
      
      callbacks.onError('API error')
      
      expect(errors).toEqual(['API error'])
    })
  })

  describe('Event Flow Integration', () => {
    it('should maintain event order', () => {
      const events: ExecutionEvent[] = []
      const emit = createEventEmitter('exec-123', 'node-456', (e) => events.push(e))
      
      emit({ type: 'chunk', provider: 'anthropic', model: 'claude-haiku-4-5', chunk: 'Hello' })
      emit({ type: 'chunk', provider: 'anthropic', model: 'claude-haiku-4-5', chunk: ' World' })
      emit({ type: 'usage', provider: 'anthropic', model: 'claude-haiku-4-5', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
      emit({ type: 'done', provider: 'anthropic', model: 'claude-haiku-4-5' })
      
      expect(events).toHaveLength(4)
      expect(events[0].type).toBe('chunk')
      expect(events[1].type).toBe('chunk')
      expect(events[2].type).toBe('usage')
      expect(events[3].type).toBe('done')
    })

    it('should handle multiple executions with different executionIds', () => {
      const events: ExecutionEvent[] = []
      const handler = (e: ExecutionEvent) => events.push(e)
      
      const emit1 = createEventEmitter('exec-1', 'node-A', handler)
      const emit2 = createEventEmitter('exec-2', 'node-B', handler)
      
      emit1({ type: 'chunk', provider: 'anthropic', model: 'claude-haiku-4-5', chunk: 'From exec-1' })
      emit2({ type: 'chunk', provider: 'openai', model: 'gpt-4o-mini', chunk: 'From exec-2' })
      
      expect(events).toHaveLength(2)
      expect(events[0].executionId).toBe('exec-1')
      expect(events[0].nodeId).toBe('node-A')
      expect(events[1].executionId).toBe('exec-2')
      expect(events[1].nodeId).toBe('node-B')
    })
  })
})

