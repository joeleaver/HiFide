/**
 * Unified execution event system for flow nodes
 *
 * This module defines a single event type that captures ALL execution events
 * from providers (chunks, tool calls, usage, etc.) with complete metadata.
 *
 * Benefits:
 * - Decouples providers from presentation logic
 * - Single source of truth for execution metadata
 * - Easy to add new event types without changing provider interfaces
 * - Enables better debugging and logging
 */

/**
 * Unique identifier for a single node execution
 * Generated each time a node executes (even if the same node executes multiple times)
 */
export type ExecutionId = string

/**
 * Tool execution event data
 */
export interface ToolEventData {
  toolCallId: string      // Provider's tool call ID (e.g., 'toolu_abc123')
  toolExecutionId: string // Our UUID for this specific tool execution
  toolName: string        // Original tool name (not sanitized)
  toolArgs?: any          // Tool arguments (for start event)
  toolResult?: any        // Tool result (for end event)
  toolError?: string      // Error message (for error event)
}

/**
 * Token usage event data
 */
export interface UsageEventData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number
}

/**
 * Detailed usage breakdown event data
 */
export interface UsageBreakdownEventData {
  input: {
    instructions?: number
    userMessages?: number
    assistantMessages?: number
    toolDefinitions?: number
    responseFormat?: number
    toolCallResults?: number
  }
  output: {
    assistantText?: number
    toolCalls?: number
  }
  // Optional per-tool breakdown
  tools?: Record<string, {
    calls?: number
    inputResults?: number // tokens from tool results sent back to model (input side)
    outputArgs?: number   // tokens from arguments sent to tool (output side)
  }>
  totals: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costEstimate?: number
  }
  estimated: boolean
}


/**
 * Rate limit wait event data
 */
export interface RateLimitWaitEventData {
  attempt: number      // 0 = proactive wait, >0 = retry attempt
  waitMs: number       // How long we're waiting
  reason?: string      // Human-readable reason
}

/**
 * Unified execution event
 * Emitted by providers and handled by FlowAPI
 */
export interface ExecutionEvent {
  // Execution metadata
  executionId: ExecutionId  // UUID for this specific node execution
  nodeId: string            // Which node is executing
  timestamp: number         // When this event occurred

  // Provider metadata
  provider: string          // 'anthropic' | 'openai' | 'gemini'
  model: string            // 'claude-haiku-4-5-20251001', etc.

  // Event type and data
  type: 'chunk' | 'tool_start' | 'tool_end' | 'tool_error' | 'usage' | 'usage_breakdown' | 'done' | 'error' | 'rate_limit_wait'

  // Event-specific data (only one will be populated based on type)
  chunk?: string
  tool?: ToolEventData
  usage?: UsageEventData
  usageBreakdown?: UsageBreakdownEventData
  error?: string
  rateLimitWait?: RateLimitWaitEventData
}

/**
 * Event emitter function type
 * Providers call this to emit execution events
 */
export type EmitExecutionEvent = (event: Omit<ExecutionEvent, 'executionId' | 'nodeId' | 'timestamp'>) => void

/**
 * Create an event emitter for a specific node execution
 *
 * @param executionId - UUID for this execution
 * @param nodeId - Node being executed
 * @param handler - Function to handle emitted events
 * @returns Event emitter function for providers to use
 */
export function createEventEmitter(
  executionId: ExecutionId,
  nodeId: string,
  handler: (event: ExecutionEvent) => void
): EmitExecutionEvent {
  return (event) => {
    handler({
      ...event,
      executionId,
      nodeId,
      timestamp: Date.now()
    })
  }
}

/**
 * Create callback functions that emit execution events
 * Providers call these simple callbacks, which are automatically converted to ExecutionEvents
 */
export function createCallbackEventEmitters(
  emit: EmitExecutionEvent,
  provider: string,
  model: string
) {
  return {
    onChunk: (text: string) => {
      emit({ type: 'chunk', provider, model, chunk: text })
    },

    onToolStart: (ev: { callId?: string; name: string; arguments?: any }) => {
      emit({
        type: 'tool_start',
        provider,
        model,
        tool: {
          toolCallId: ev.callId || '',
          toolExecutionId: crypto.randomUUID(),
          toolName: ev.name,
          toolArgs: ev.arguments
        }
      })
    },

    onToolEnd: (ev: { callId?: string; name: string; result?: any }) => {
      emit({
        type: 'tool_end',
        provider,
        model,
        tool: {
          toolCallId: ev.callId || '',
          toolExecutionId: '', // Will be matched by callId
          toolName: ev.name,
          toolResult: ev.result
        }
      })
    },

    onToolError: (ev: { callId?: string; name: string; error: string }) => {
      emit({
        type: 'tool_error',
        provider,
        model,
        tool: {
          toolCallId: ev.callId || '',
          toolExecutionId: '', // Will be matched by callId
          toolName: ev.name,
          toolError: ev.error
        }
      })
    },

    onTokenUsage: (usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number }) => {
      emit({
        type: 'usage',
        provider,
        model,
        usage
      })
    },

    onDone: () => {
      emit({ type: 'done', provider, model })
    },

    onError: (error: string) => {
      emit({ type: 'error', provider, model, error })
    }
  }
}

// Back-compat alias used by existing tests and adapters
export function executionEventToLegacyCallbacks(
  emit: EmitExecutionEvent,
  provider: string,
  model: string
) {
  return createCallbackEventEmitters(emit, provider, model)
}


