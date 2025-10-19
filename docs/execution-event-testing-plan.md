# Execution Event System - Testing Plan

## Overview

Now that Phase 1 is complete, we need to test the execution event system to ensure:
1. Events are emitted correctly with complete metadata
2. Events reach the store handlers
3. Execution IDs are unique and properly tracked
4. The system works end-to-end with real flows

## Test Scenarios

### Test 1: Simple LLM Request (No Tools)

**Setup**:
- Create a flow with: Context Start → LLM Request → User Input
- Send a simple message: "Hello, how are you?"

**Expected Events**:
```
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: chunk { chunk: "Hello", provider: "openai", model: "gpt-4o-mini" }
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: chunk { chunk: "! I'm", provider: "openai", model: "gpt-4o-mini" }
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: chunk { chunk: " doing", provider: "openai", model: "gpt-4o-mini" }
...
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: usage { inputTokens: 10, outputTokens: 15, totalTokens: 25 }
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: done
```

**Verification**:
- ✅ All events have same `executionId`
- ✅ All events have correct `nodeId`
- ✅ All events have correct `provider` and `model`
- ✅ Chunks appear in conversation UI
- ✅ Usage appears in session stats

### Test 2: LLM Request with Tools (Anthropic)

**Setup**:
- Create a flow with: Context Start → LLM Request (with tools) → User Input
- Send: "What's the weather in San Francisco?"
- Tools: `get_weather(location: string)`

**Expected Events**:
```
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: chunk { chunk: "Let me", provider: "anthropic", model: "claude-haiku-4-5" }
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: chunk { chunk: " check", provider: "anthropic", model: "claude-haiku-4-5" }
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: tool_start {
  tool: {
    toolCallId: "toolu_abc123",
    toolExecutionId: "tool-exec-uuid-1",
    toolName: "get_weather",
    toolArgs: { location: "San Francisco" }
  }
}
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: tool_end {
  tool: {
    toolCallId: "toolu_abc123",
    toolExecutionId: "tool-exec-uuid-1",
    toolName: "get_weather",
    toolResult: "Sunny, 72°F"
  }
}
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: chunk { chunk: "The weather", provider: "anthropic", model: "claude-haiku-4-5" }
...
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: usage { inputTokens: 50, outputTokens: 30, totalTokens: 80 }
[ExecutionEvent] llmRequest-456 [exec-uuid-2]: done
```

**Verification**:
- ✅ Tool start event emitted before tool execution
- ✅ Tool end event emitted after tool execution
- ✅ Tool badge appears in UI
- ✅ Tool badge updates when tool completes
- ✅ All events have same `executionId`

### Test 3: Intent Router (skipHistory)

**Setup**:
- Create a flow with: Context Start → Intent Router → branches
- Send: "Hello there!"
- Routes: { greeting: "...", question: "..." }

**Expected Events**:
```
[ExecutionEvent] intentRouter-789 [exec-uuid-3]: usage { inputTokens: 20, outputTokens: 5, totalTokens: 25 }
[ExecutionEvent] intentRouter-789 [exec-uuid-3]: done
```

**Verification**:
- ✅ NO chunk events (skipHistory suppresses them)
- ✅ Usage event still emitted
- ✅ Intent badge appears in UI
- ✅ Flow routes to correct branch

### Test 4: Multiple Executions of Same Node

**Setup**:
- Create a flow with a loop: Context Start → LLM Request → Portal Input → Portal Output (loops back)
- Send 3 messages in sequence

**Expected Events**:
```
// First execution
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: chunk ...
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: done

// Second execution (same node, different executionId)
[ExecutionEvent] llmRequest-123 [exec-uuid-2]: chunk ...
[ExecutionEvent] llmRequest-123 [exec-uuid-2]: done

// Third execution
[ExecutionEvent] llmRequest-123 [exec-uuid-3]: chunk ...
[ExecutionEvent] llmRequest-123 [exec-uuid-3]: done
```

**Verification**:
- ✅ Each execution has unique `executionId`
- ✅ All executions have same `nodeId`
- ✅ Events are properly grouped by `executionId`
- ✅ Three separate conversation boxes appear

### Test 5: Error Handling

**Setup**:
- Create a flow with: Context Start → LLM Request
- Use invalid API key

**Expected Events**:
```
[ExecutionEvent] llmRequest-123 [exec-uuid-1]: error { error: "Invalid API key" }
```

**Verification**:
- ✅ Error event emitted
- ✅ Error appears in UI
- ✅ Flow stops gracefully

## Manual Testing Checklist

### Setup
- [ ] Open HiFide application
- [ ] Create a new session
- [ ] Open browser DevTools console
- [ ] Filter console for `[ExecutionEvent]`

### Test 1: Simple Chat
- [ ] Create flow: Context Start → LLM Request → User Input
- [ ] Send message: "Hello!"
- [ ] Verify chunk events in console
- [ ] Verify chunks appear in UI
- [ ] Verify usage event in console
- [ ] Verify done event in console

### Test 2: Tool Calling
- [ ] Create flow: Context Start → LLM Request (with tools) → User Input
- [ ] Add tools node with `get_weather` tool
- [ ] Send message: "What's the weather?"
- [ ] Verify tool_start event in console
- [ ] Verify tool badge appears in UI
- [ ] Verify tool_end event in console
- [ ] Verify tool badge updates in UI
- [ ] Verify final response appears

### Test 3: Intent Router
- [ ] Create flow: Context Start → Intent Router → branches
- [ ] Configure routes: greeting, question
- [ ] Send message: "Hello!"
- [ ] Verify NO chunk events in console (skipHistory)
- [ ] Verify usage event in console
- [ ] Verify intent badge appears in UI
- [ ] Verify flow routes correctly

### Test 4: Loop Execution
- [ ] Create flow with portal loop
- [ ] Send 3 messages
- [ ] Verify 3 different executionIds in console
- [ ] Verify 3 conversation boxes in UI
- [ ] Verify events grouped by executionId

### Test 5: Error Handling
- [ ] Temporarily use invalid API key
- [ ] Send message
- [ ] Verify error event in console
- [ ] Verify error appears in UI
- [ ] Restore valid API key

## Automated Testing (Future)

Once manual testing passes, we can create automated tests:

```typescript
describe('Execution Event System', () => {
  it('should emit events with correct metadata', async () => {
    const events: ExecutionEvent[] = []
    const mockEmit = (event) => events.push(event)
    
    // Execute node with mock emitter
    await llmRequestNode(flowAPI, context, message, inputs, config)
    
    // Verify events
    expect(events).toHaveLength(3) // chunk, usage, done
    expect(events[0].type).toBe('chunk')
    expect(events[0].executionId).toBe(flowAPI.executionId)
    expect(events[0].nodeId).toBe(flowAPI.nodeId)
  })
})
```

## Success Criteria

Phase 1 is successful if:
- ✅ All test scenarios pass
- ✅ Events have complete metadata (executionId, nodeId, provider, model, timestamp)
- ✅ Events reach store handlers correctly
- ✅ UI updates correctly based on events
- ✅ No regressions in existing functionality
- ✅ Execution IDs are unique per execution
- ✅ skipHistory works correctly

## Next Steps After Testing

Once testing is complete:
1. Document any issues found
2. Fix any bugs discovered
3. Consider adding event recording/replay for debugging
4. Consider adding event metrics/analytics
5. Consider migrating providers to emit events directly (optional)

