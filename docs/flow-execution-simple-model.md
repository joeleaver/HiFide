# Flow Execution: Simple Trigger Model

## Core Principles

1. **Nodes are idempotent** - Same inputs → same outputs, can execute multiple times
2. **No complex readiness checks** - Nodes are simply triggered by predecessors
3. **No memoization** - Nodes execute every time they're triggered (if not already executing)
4. **Execution policies determine input requirements** - `'any'` or `'all'`

## Execution Flow

### 1. Entry Nodes Execute
- Nodes with no incoming edges execute first
- Example: `defaultContextStart`

### 2. Node Execution
When a node is triggered:
1. Check if already executing → skip (avoid recursion)
2. Mark as executing
3. Pull dependencies based on policy (see below)
4. Collect available inputs
5. Execute node function
6. Store outputs
7. Mark as completed
8. **Trigger ALL successors** (don't check if they're "ready")

### 3. Dependency Pulling

**For `'any'` policy nodes:**
- Don't try to pull incomplete dependencies
- Use whatever inputs are already available
- Skip dependencies that are currently executing (loop detection)

**For `'all'` policy nodes:**
- Pull ALL dependencies
- Error if any dependency is currently executing (true circular dependency)

### 4. Successor Triggering

After a node completes:
- Trigger ALL successors unconditionally
- Each successor decides if it can execute based on available inputs
- If a successor is already executing, it skips (returns early)

## How Loops Work

```
defaultContextStart → userInput → chat
                          ↑         ↓
                          └─────────┘
```

**Iteration 1:**
1. `defaultContextStart` executes
2. Triggers `userInput`
3. `userInput` checks inputs: has input from `defaultContextStart` ✓
4. `userInput` executes, pauses
5. User provides input
6. `userInput` completes, triggers `chat`
7. `chat` checks inputs: has input from `userInput` ✓
8. `chat` executes

**Iteration 2:**
9. `chat` completes, triggers `userInput`
10. `userInput` checks if already executing: NO (it completed in step 6)
11. `userInput` checks inputs: has input from `chat` ✓
12. `userInput` executes again, pauses
13. Loop continues...

## Key Differences from Previous Design

| Aspect | Old Design | New Design |
|--------|-----------|------------|
| Memoization | Yes - nodes execute once | No - nodes can execute multiple times |
| Readiness | Complex `isNodeReady()` checks | Simple: just trigger and let node decide |
| State reset | Complex reset logic | No reset needed - just re-execute |
| Loop support | Special "re-executable" flag | Works naturally |
| Complexity | High - many state maps | Low - simple trigger model |

## Benefits

1. **Simpler** - No complex readiness logic
2. **More flexible** - Nodes naturally support loops
3. **Easier to debug** - Clear execution flow
4. **Idempotent** - Predictable behavior
5. **No special cases** - All nodes work the same way

## Example Trace

```
[Entry Nodes] defaultContextStart
[Executing] defaultContextStart
[Completed] defaultContextStart
[Trigger] userInput
[Executing] userInput
[Status] Paused
[Resumed] userInput
[Completed] userInput
[Trigger] chat
[Executing] chat
[Completed] chat
[Trigger] userInput
[Executing] userInput  ← Re-execution!
[Status] Paused
...
```

## Implementation Notes

### No Memoization
```typescript
// OLD: Check if already completed
if (this.executionState.get(nodeId) === 'completed') {
  return cachedResult
}

// NEW: Just check if currently executing
if (this.executionState.get(nodeId) === 'executing') {
  return // Skip to avoid recursion
}
```

### Simple Triggering
```typescript
// OLD: Check if ready before triggering
for (const successorId of successorIds) {
  if (isNodeReady(successorId)) {
    await executeNode(successorId)
  }
}

// NEW: Just trigger all successors
for (const successorId of successorIds) {
  await executeNode(successorId)
}
```

### Node Decides
```typescript
// Inside executeNode():
// Node checks its own inputs and decides if it can proceed
// If not enough inputs, just return early
```

## Future Enhancements

- **Conditional execution** - Nodes can check input values and decide not to execute
- **Partial execution** - Execute with subset of inputs, store partial results
- **Priority** - Execute certain paths first
- **Parallel execution** - Execute independent branches in parallel

