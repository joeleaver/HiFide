# Execution Event Refactor Proposal

## Problem

Currently, providers are tightly coupled to presentation logic through callbacks like `onChunk`, `onToolStart`, etc. This creates several issues:

1. **Tight Coupling**: Providers must understand UI concerns (when to show badges, how to group output)
2. **Fragile Stream Parsing**: Anthropic provider has ~150 lines of complex stream event parsing that's prone to bugs
3. **Inconsistent Metadata**: Different callbacks receive different metadata (some have provider/model, some don't)
4. **Hard to Debug**: No single place to see all events from a node execution
5. **No Execution Tracking**: Can't correlate events from the same node execution

## Solution: Unified Execution Events

### Architecture

```
┌─────────────┐
│  Provider   │  Emits raw execution events with complete metadata
│ (Anthropic) │  - No UI concerns
│             │  - Just execution facts
└──────┬──────┘
       │ ExecutionEvent { executionId, nodeId, provider, model, type, data }
       ▼
┌─────────────┐
│  FlowAPI    │  Single event handler
│             │  - Receives all events
│             │  - Decides what to display
│             │  - Groups by executionId
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Zustand     │  Presentation logic
│  Store      │  - Creates conversation boxes
│             │  - Shows badges
│             │  - Formats output
└─────────────┘
```

### Key Concepts

#### 1. Execution ID
Every time a node executes, generate a UUID:
```typescript
const executionId = crypto.randomUUID()
```

This allows us to:
- Group all events from a single execution
- Track multiple executions of the same node
- Correlate tool calls with their results

#### 2. Unified Event Type
Single event type captures everything:
```typescript
interface ExecutionEvent {
  executionId: string    // UUID for this execution
  nodeId: string         // Which node
  timestamp: number      // When
  provider: string       // 'anthropic' | 'openai' | 'gemini'
  model: string         // 'claude-haiku-4-5-20251001'
  
  type: 'chunk' | 'tool_start' | 'tool_end' | 'tool_error' | 'usage' | 'done' | 'error'
  
  // Event-specific data
  chunk?: string
  tool?: { toolCallId, toolExecutionId, toolName, toolArgs, toolResult, toolError }
  usage?: { inputTokens, outputTokens, totalTokens, cachedTokens }
  error?: string
}
```

#### 3. FlowAPI Event Handler
Single method handles all events:
```typescript
class FlowAPI {
  emitExecutionEvent(event: ExecutionEvent): void {
    // Route to appropriate handler based on event type
    switch (event.type) {
      case 'chunk':
        this.handleChunk(event)
        break
      case 'tool_start':
        this.handleToolStart(event)
        break
      // ... etc
    }
  }
}
```

### Migration Path

#### Phase 1: Add Event System (Non-Breaking)
1. Create `execution-events.ts` with types ✅ (done)
2. Add `emitExecutionEvent()` to FlowAPI
3. Add adapter to convert events → legacy callbacks
4. Update llm-service to use event emitter

#### Phase 2: Update Providers (One at a Time)
1. Start with Anthropic (most complex)
2. Simplify stream parsing - just emit events
3. Remove ~150 lines of complex callback logic
4. Test thoroughly

#### Phase 3: Update Other Providers
1. OpenAI
2. Gemini

#### Phase 4: Remove Legacy Callbacks
1. Remove adapter
2. Remove old callback parameters from provider interface
3. Clean up

## Example: Before vs After

### Before (Current - Anthropic Provider)
```typescript
// 150+ lines of stream parsing
for await (const evt of stream) {
  if (evt?.type === 'content_block_delta') {
    if (evt?.delta?.type === 'text_delta') {
      onChunk(evt.delta.text)  // UI concern in provider!
    }
    else if (evt?.delta?.type === 'input_json_delta') {
      // Complex JSON accumulation logic
      active[id].inputText += chunk
    }
  }
  else if (evt?.type === 'content_block_start') {
    // Track tool calls
    active[id] = { id, name, inputText: '' }
  }
  else if (evt?.type === 'content_block_stop') {
    // Parse and complete tool calls
    const parsed = JSON.parse(active[id].inputText)
    completed.push({ id, name, input: parsed })
  }
}

// Check for incomplete tool calls
if (Object.keys(active).length > 0) {
  // Recovery logic...
}

// Execute tools
if (completed.length > 0) {
  onToolStart({ name, callId, arguments })  // UI concern!
  const result = await tool.run(input)
  onToolEnd({ name, callId })  // UI concern!
}
```

### After (Proposed - Anthropic Provider)
```typescript
// Simple stream parsing - just emit events
for await (const evt of stream) {
  if (evt?.type === 'content_block_delta') {
    if (evt?.delta?.type === 'text_delta') {
      emit({ type: 'chunk', provider, model, chunk: evt.delta.text })
    }
    else if (evt?.delta?.type === 'input_json_delta') {
      // Still accumulate, but simpler
      active[id].inputText += chunk
    }
  }
  else if (evt?.type === 'content_block_start') {
    active[id] = { id, name, inputText: '' }
    emit({
      type: 'tool_start',
      provider,
      model,
      tool: {
        toolCallId: id,
        toolExecutionId: crypto.randomUUID(),
        toolName: name
      }
    })
  }
  else if (evt?.type === 'content_block_stop') {
    const parsed = JSON.parse(active[id].inputText)
    completed.push({ id, name, input: parsed })
  }
}

// Execute tools (same as before)
for (const tc of completed) {
  const result = await tool.run(tc.input)
  emit({
    type: 'tool_end',
    provider,
    model,
    tool: {
      toolCallId: tc.id,
      toolExecutionId: '', // Matched by callId
      toolName: tc.name,
      toolResult: result
    }
  })
}
```

## Benefits

### 1. Separation of Concerns
- **Providers**: Execute LLMs, emit facts
- **FlowAPI**: Route events, apply business logic
- **Store**: Presentation, UI updates

### 2. Better Debugging
```typescript
// Single place to log ALL events
emitExecutionEvent(event: ExecutionEvent) {
  console.log('[ExecutionEvent]', event)
  // Can easily add event recording, replay, etc.
}
```

### 3. Easier Testing
```typescript
// Test provider without mocking UI
const events: ExecutionEvent[] = []
const emit = (e) => events.push(e)

await provider.agentStream({ ..., emit })

expect(events).toContainEqual({
  type: 'chunk',
  chunk: 'Hello'
})
```

### 4. Future Features
- **Event Recording**: Record all events for debugging
- **Event Replay**: Replay executions for testing
- **Event Filtering**: Filter events by type, node, etc.
- **Event Metrics**: Track execution performance
- **Event Streaming**: Stream events to external systems

## Open Questions

1. **Should we track execution ID in the scheduler?**
   - Yes - scheduler should generate executionId and pass to nodes
   - Allows correlation across node boundaries

2. **Should we batch events or emit individually?**
   - Emit individually for real-time updates
   - Can add batching later if performance is an issue

3. **Should we persist events?**
   - Not initially - just in-memory
   - Can add persistence later for debugging

4. **How to handle tool execution IDs?**
   - Generate UUID when tool starts
   - Include in tool_end/tool_error events
   - Allows tracking tool execution across async boundaries

## Next Steps

1. Review this proposal
2. Decide on migration approach
3. Implement Phase 1 (event system + adapter)
4. Test with Anthropic provider
5. Migrate other providers
6. Remove legacy callbacks

