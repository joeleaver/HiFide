# Testing Recommendations

## Critical Test Cases Missing

### Test #1: Anthropic System Message Format
```typescript
it('should handle Anthropic system message blocks', async () => {
  const system = [{ type: 'text', text: 'You are helpful' }]
  const messages = [{ role: 'user', content: 'Hello' }]
  
  // Should NOT convert blocks to string
  // Should pass blocks as-is to API
  
  const result = await provider.agentStream({
    apiKey: 'test-key',
    model: 'claude-3-5-haiku',
    system,  // Array of blocks
    messages,
    tools: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {}
  })
  
  // Verify system message format in request
})
```

### Test #2: Async Loop Completion
```typescript
it('should complete streaming before returning', async () => {
  let streamingDone = false
  
  const handle = await provider.agentStream({
    // ...
    onDone: () => { streamingDone = true }
  })
  
  // Currently fails: streamingDone is false here
  // Should wait for streaming to complete
  expect(streamingDone).toBe(true)
})
```

### Test #3: Reasoning State Reset
```typescript
it('should reset reasoning state between steps', async () => {
  // Mock provider that returns tool calls
  // Step 1: Returns reasoning with <think> tags
  // Step 2: Should NOT have reasoning from step 1
  
  const reasoningChunks: string[] = []
  
  await provider.agentStream({
    // ...
    emit: (event) => {
      if (event.type === 'reasoning') {
        reasoningChunks.push(event.reasoning)
      }
    }
  })
  
  // Verify reasoning from step 1 doesn't appear in step 2
})
```

### Test #4: Parallel Tool Calls
```typescript
it('should handle parallel tool calls correctly', async () => {
  const toolCalls: any[] = []
  
  await provider.agentStream({
    // ...
    onToolStart: (ev) => { toolCalls.push(ev) }
  })
  
  // Should have 2 separate tool calls, not merged
  expect(toolCalls).toHaveLength(2)
  expect(toolCalls[0].name).toBe('tool_1')
  expect(toolCalls[1].name).toBe('tool_2')
})
```

### Test #5: ResponseSchema Handling
```typescript
it('should include responseSchema in request', async () => {
  const schema = {
    type: 'object',
    properties: { result: { type: 'string' } }
  }
  
  // Mock OpenAI client to capture request
  const capturedRequest = null
  
  await provider.agentStream({
    // ...
    responseSchema: schema
  })
  
  // Verify schema was included in request body
  expect(capturedRequest.response_format).toBeDefined()
})
```

## Provider-Specific Tests

### Gemini Format Test
```typescript
it('should use Gemini native format for Gemini provider', async () => {
  // Gemini provider should:
  // 1. Accept contents array (not messages)
  // 2. NOT convert to OpenAI format
  // 3. Handle tool results with user role workaround
})
```

### Anthropic Blocks Test
```typescript
it('should preserve Anthropic block format', async () => {
  // Anthropic provider should:
  // 1. Accept system as blocks array
  // 2. NOT convert to string
  // 3. Handle tool results with tool role
})
```

## Integration Tests

### Multi-Step Agent Test
```typescript
it('should handle multi-step agent loops', async () => {
  // 1. First step: returns tool call
  // 2. Second step: executes tool, returns result
  // 3. Third step: returns final response
  
  // Verify all steps complete correctly
  // Verify state doesn't corrupt between steps
})
```

### Cancellation Test
```typescript
it('should properly cancel streaming', async () => {
  const handle = provider.agentStream({ ... })
  
  // Cancel immediately
  handle.cancel()
  
  // Should stop streaming
  // Should not call onDone
  // Should not call onError
})
```

## Test Coverage Goals

- [ ] Each provider format (OpenAI, Anthropic, Gemini)
- [ ] System message handling
- [ ] Async completion
- [ ] Reasoning state reset
- [ ] Parallel tool calls
- [ ] ResponseSchema inclusion
- [ ] Multi-step loops
- [ ] Cancellation
- [ ] Error handling
- [ ] Rate limit retries

## Current Test Status

Check `electron/providers/__tests__/execution-events-integration.test.ts`:
- Has basic provider tests
- Missing format-specific tests
- Missing state corruption tests
- Missing async completion tests

