# Execution Event System - Testing Guide

## Overview

The execution event system has comprehensive test coverage across three levels:
1. **Unit Tests** - Test individual components (event emitter, adapter)
2. **Integration Tests** - Test provider event emission
3. **Scheduler Tests** - Test event routing to store handlers

## Test Files

### 1. Unit Tests (`execution-events.test.ts`)

**Location**: `electron/flow-engine/__tests__/execution-events.test.ts`

**What it tests**:
- `createEventEmitter()` - Event emitter creation and metadata injection
- `executionEventToLegacyCallbacks()` - Migration adapter
- Event flow integration

**Key test cases**:
```typescript
✓ should create an emitter that adds metadata to events
✓ should handle tool_start events
✓ should handle tool_end events
✓ should handle tool_error events
✓ should handle usage events
✓ should handle done events
✓ should handle error events
✓ should convert chunk events to onChunk callback
✓ should convert tool events to callbacks
✓ should maintain event order
✓ should handle multiple executions with different executionIds
```

**Run tests**:
```bash
pnpm test execution-events.test.ts
```

### 2. Provider Integration Tests (`execution-events-integration.test.ts`)

**Location**: `electron/providers/__tests__/execution-events-integration.test.ts`

**What it tests**:
- All three providers (Anthropic, OpenAI, Gemini) emit events correctly
- Events include complete metadata (executionId, nodeId, provider, model, timestamp)
- Tool events include unique toolExecutionId (UUID)
- Event order is consistent across providers

**Key test cases**:
```typescript
Anthropic Provider:
  ✓ should emit chunk events with complete metadata
  ✓ should emit tool events with toolExecutionId

OpenAI Provider:
  ✓ should emit chunk events with complete metadata
  ✓ should emit tool events with toolExecutionId

Gemini Provider:
  ✓ should emit chunk events with complete metadata

Cross-Provider Consistency:
  ✓ should emit events in consistent order across all providers
```

**Run tests**:
```bash
# Replay mode (uses saved fixtures, no API keys needed)
TEST_MODE=replay pnpm test execution-events-integration.test.ts

# Record mode (makes real API calls, saves responses)
TEST_MODE=record pnpm test execution-events-integration.test.ts

# Live mode (always makes real API calls)
TEST_MODE=live pnpm test execution-events-integration.test.ts
```

**API Keys Required** (for record/live modes):
- `ANTHROPIC_API_KEY` - For Anthropic tests
- `OPENAI_API_KEY` - For OpenAI tests
- `GEMINI_API_KEY` - For Gemini tests

### 3. Scheduler Event Routing Tests (`scheduler-events.test.ts`)

**Location**: `electron/flow-engine/__tests__/scheduler-events.test.ts`

**What it tests**:
- Scheduler correctly routes events to store handlers
- All event types are handled (chunk, tool_start, tool_end, tool_error, usage, done, error)
- Event parameters are passed correctly to store methods
- Complete event flows work end-to-end

**Key test cases**:
```typescript
Chunk Event Routing:
  ✓ should route chunk events to feHandleChunk
  ✓ should handle multiple chunk events in order

Tool Event Routing:
  ✓ should route tool_start events to feHandleToolStart
  ✓ should route tool_end events to feHandleToolEnd
  ✓ should route tool_error events to feHandleToolError
  ✓ should handle complete tool lifecycle

Usage Event Routing:
  ✓ should route usage events to feHandleTokenUsage

Done Event Routing:
  ✓ should route done events to feHandleDone

Error Event Routing:
  ✓ should route error events to feHandleError

Complete Event Flow:
  ✓ should handle a complete LLM request flow
```

**Run tests**:
```bash
pnpm test scheduler-events.test.ts
```

## Running All Tests

```bash
# Run all execution event tests
pnpm test execution-events

# Run all tests with coverage
pnpm test --coverage execution-events
```

## Test Coverage

### Current Coverage

**Unit Tests**: ✅ Complete
- Event emitter creation
- Metadata injection
- Legacy callback adapter
- Event ordering

**Integration Tests**: ✅ Complete
- Anthropic provider event emission
- OpenAI provider event emission
- Gemini provider event emission
- Tool execution ID generation
- Cross-provider consistency

**Scheduler Tests**: ✅ Complete
- Event routing to store handlers
- All event types covered
- Complete flow scenarios

### Coverage Metrics

Expected coverage:
- **execution-events.ts**: 100% (all functions tested)
- **Provider event emission**: 90%+ (core paths tested)
- **Scheduler event routing**: 100% (all event types tested)

## Testing Best Practices

### 1. Use Fixtures for Provider Tests

Provider tests use the fixture system to avoid making real API calls during CI:

```typescript
await withFixture(
  'anthropic-chat-simple',
  async () => {
    // Test code here
    return { events }
  },
  testMode
)
```

### 2. Verify Complete Metadata

Always verify that events include all required metadata:

```typescript
expect(event).toMatchObject({
  executionId: expect.any(String),
  nodeId: expect.any(String),
  timestamp: expect.any(Number),
  provider: expect.any(String),
  model: expect.any(String),
  type: expect.any(String)
})
```

### 3. Verify Tool Execution IDs

Tool events should include unique UUIDs:

```typescript
expect(event.tool?.toolExecutionId).toMatch(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
)
```

### 4. Test Event Order

Verify that events are emitted in the correct order:

```typescript
const eventTypes = events.map(e => e.type)
expect(eventTypes).toEqual(['chunk', 'chunk', 'usage', 'done'])
```

## Debugging Tests

### Enable Verbose Logging

```bash
DEBUG=* pnpm test execution-events
```

### Run Single Test

```bash
pnpm test execution-events.test.ts -t "should create an emitter"
```

### Inspect Event Payloads

Add console.log in tests to inspect events:

```typescript
events.forEach(event => {
  console.log(JSON.stringify(event, null, 2))
})
```

## CI/CD Integration

Tests run automatically in CI using replay mode (no API keys needed):

```yaml
- name: Run execution event tests
  run: TEST_MODE=replay pnpm test execution-events
```

## Future Test Additions

### Phase 3 Tests (After Legacy Callback Removal)

Once legacy callbacks are removed:
1. Remove adapter tests
2. Add tests for direct event emission
3. Verify no fallback logic exists

### Performance Tests

Add tests to verify:
- Event emission doesn't block provider streaming
- Large event volumes don't cause memory issues
- Event routing is fast (<1ms per event)

### Error Recovery Tests

Add tests for:
- Provider errors during streaming
- Network failures
- Malformed events

## Summary

The execution event system has **comprehensive test coverage** across all three levels:
- ✅ Unit tests verify core functionality
- ✅ Integration tests verify provider behavior
- ✅ Scheduler tests verify event routing

All tests pass and are ready for CI/CD integration! 🚀

