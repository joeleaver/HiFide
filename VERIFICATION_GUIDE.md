# Verification Guide - Testing the Fixes

## Quick Verification Steps

### 1. Anthropic System Message Fix
**Test:** Anthropic agent should follow system instructions

```bash
# Run with Anthropic provider
# System instruction: "Always respond in exactly 2 sentences"
# Query: "What is AI?"

# Expected: Response is exactly 2 sentences
# Before fix: System instruction ignored
# After fix: System instruction followed
```

**How to test:**
1. Set provider to Anthropic
2. Set system instruction to something specific
3. Run agent
4. Verify system instruction is followed

---

### 2. Async Loop Completion Fix
**Test:** onDone() should be called before function returns

```typescript
// Add this test to verify async completion
let doneCalled = false
const handle = await provider.agentStream({
  // ... config
  onDone: () => { doneCalled = true }
})

// Before fix: doneCalled is false here
// After fix: doneCalled is true here (or very soon)
expect(doneCalled).toBe(true)
```

**How to test:**
1. Add logging to onDone callback
2. Add logging after agentStream returns
3. Verify onDone is called before or immediately after return

---

### 3. Reasoning State Reset Fix
**Test:** Reasoning from step 1 shouldn't appear in step 2

```bash
# Run multi-step agent with reasoning
# Step 1: Returns reasoning with <think> tags
# Step 2: Should NOT have reasoning from step 1

# Before fix: Reasoning bleeds between steps
# After fix: Each step has clean reasoning state
```

**How to test:**
1. Run agent with multiple tool calls
2. Check reasoning output for each step
3. Verify reasoning doesn't accumulate

---

### 4. Tool Call Deduplication Fix
**Test:** Parallel tool calls should execute separately

```bash
# Run agent with multiple parallel tools
# Example: "Get weather for SF and NYC"

# Before fix: Tools merge, only one executes
# After fix: Both tools execute correctly
```

**How to test:**
1. Create agent with 2+ tools
2. Ask for parallel execution
3. Verify all tools are called
4. Verify arguments aren't corrupted

---

### 5. ResponseSchema Fix
**Test:** Structured outputs should work

```bash
# Run with responseSchema parameter
# Example: { type: 'object', properties: { result: { type: 'string' } } }

# Before fix: Schema ignored, output is unstructured
# After fix: Output follows schema
```

**How to test:**
1. Pass responseSchema to agentStream
2. Verify response matches schema
3. Check that response_format is in request

---

## Comprehensive Test Suite

### Provider Tests
- [ ] OpenAI basic chat
- [ ] OpenAI with tools
- [ ] OpenAI with structured output
- [ ] Anthropic basic chat
- [ ] Anthropic with system blocks
- [ ] Anthropic with tools
- [ ] Gemini basic chat
- [ ] Gemini with tools
- [ ] Fireworks basic chat
- [ ] Fireworks with tools
- [ ] xAI basic chat
- [ ] xAI with tools
- [ ] OpenRouter basic chat
- [ ] OpenRouter with tools

### Feature Tests
- [ ] Multi-step agent loops
- [ ] Parallel tool calls
- [ ] Tool error handling
- [ ] Cancellation
- [ ] Rate limit retries
- [ ] Reasoning extraction
- [ ] Structured outputs
- [ ] Token usage tracking

### Edge Cases
- [ ] Empty system message
- [ ] Empty messages array
- [ ] No tools provided
- [ ] Tool with no parameters
- [ ] Tool execution error
- [ ] Stream interruption
- [ ] Malformed tool response

---

## Regression Testing

Run existing test suite:
```bash
npm test -- electron/providers/__tests__/execution-events-integration.test.ts
npm test -- electron/flow-engine/nodes/__tests__/llmRequest.test.ts
```

Verify:
- All existing tests still pass
- No new failures introduced
- Performance is unchanged

---

## Manual Testing Checklist

- [ ] Test each provider individually
- [ ] Test multi-step agents
- [ ] Test parallel tools
- [ ] Test cancellation
- [ ] Test error handling
- [ ] Test with different models
- [ ] Test with different temperatures
- [ ] Test with reasoning enabled
- [ ] Test with thinking budget
- [ ] Test structured outputs

---

## Performance Verification

- [ ] No performance regression
- [ ] Memory usage unchanged
- [ ] No additional allocations
- [ ] Streaming latency unchanged

---

## Success Criteria

All fixes are successful when:
1. ✅ Anthropic agents follow system instructions
2. ✅ onDone() called before function returns
3. ✅ Reasoning doesn't bleed between steps
4. ✅ Parallel tools execute correctly
5. ✅ Structured outputs work
6. ✅ All existing tests pass
7. ✅ No performance regression

