# Flow Execution Policies

## Overview

Each node type in the flow system has an **execution policy** that determines when it's ready to execute based on its incoming edges.

**Key principle:** Nodes are **idempotent** and can execute multiple times. After a node completes and pushes outputs to successors, its state is reset, allowing it to execute again when new inputs arrive.

## Execution Policies

### 1. `any` (OR Logic) - Default

**When to use:** Most nodes, especially those in loops or with optional inputs.

**Behavior:** Node executes when **ANY** predecessor completes.

**Use cases:**
- **userInput**: Can execute after initial context OR after assistant response (supports loops)
- **chat**: Can execute with just a message (tools are optional)
- **defaultContextStart**: Entry node with no inputs
- **tools**: Provides tools, no inputs needed

**Example:**
```
A → C ← B
```
With `any` policy, `C` executes as soon as either `A` OR `B` completes.

### 2. `all` (AND Logic)

**When to use:** Join/collect nodes that need to synchronize multiple inputs.

**Behavior:** Node executes when **ALL** predecessors complete.

**Use cases:**
- **parallelJoin**: Wait for all parallel branches to complete
- **collect**: Gather outputs from multiple sources
- **merge**: Combine data from multiple inputs

**Example:**
```
A → C ← B
```
With `all` policy, `C` waits until BOTH `A` AND `B` complete.

### 3. `custom`

**When to use:** Advanced scenarios where node needs custom readiness logic.

**Behavior:** Node function provides custom logic to determine readiness.

**Use cases:**
- Conditional execution based on input values
- Dynamic input requirements
- Complex synchronization patterns

## How Loops Work

Conversation loops work because of the `any` policy:

```
defaultContextStart → userInput → chat
                          ↑         ↓
                          └─────────┘
```

**First iteration:**
1. `defaultContextStart` completes
2. `userInput` becomes ready (has input from `defaultContextStart`)
3. `userInput` executes and pauses
4. User provides input
5. `chat` becomes ready (has input from `userInput`)
6. `chat` executes

**Subsequent iterations:**
7. `chat` completes and sends output back to `userInput`
8. `userInput` becomes ready again (has input from `chat`)
9. Loop continues...

## Setting Execution Policy

### In Node Registry (Default)

```typescript
const NODE_REGISTRY: Record<string, NodeMetadata> = {
  userInput: {
    fn: userInputNode,
    executionPolicy: 'any' // Default for this node type
  },
  parallelJoin: {
    fn: parallelJoinNode,
    executionPolicy: 'all' // Wait for all inputs
  }
}
```

### In Flow Definition (Override)

```json
{
  "nodes": [
    {
      "id": "my-chat",
      "type": "chat",
      "executionPolicy": "all", // Override default 'any' policy
      "config": {}
    }
  ]
}
```

## Policy Selection Guide

| Scenario | Policy | Reason |
|----------|--------|--------|
| Entry node (no inputs) | `any` | Always ready |
| Loop participant | `any` | Can execute on any iteration |
| Optional inputs | `any` | Can proceed without all inputs |
| Required synchronization | `all` | Must wait for all inputs |
| Parallel join | `all` | Synchronize parallel branches |
| Data merge | `all` | Need all data sources |
| Custom logic | `custom` | Special requirements |

## Implementation Details

### Scheduler Logic

```typescript
private isNodeReady(nodeId: string): boolean {
  // Check execution state
  if (state === 'executing' || state === 'completed' || state === 'paused') {
    return false
  }
  
  // Entry nodes are always ready
  if (incomingEdges.length === 0) {
    return true
  }
  
  // Get policy
  const policy = getNodeExecutionPolicy(node)
  
  // Apply policy
  if (policy === 'any') {
    // OR: At least one input ready
    return incomingEdges.some(e => executionState.get(e.source) === 'completed')
  } else if (policy === 'all') {
    // AND: All inputs ready
    return incomingEdges.every(e => executionState.get(e.source) === 'completed')
  }
}
```

### Memoization

Nodes execute **once per flow run** regardless of policy. The execution state prevents duplicate execution:

```typescript
if (executionState.get(nodeId) === 'completed') {
  return cachedResult // Don't execute again
}
```

## Best Practices

1. **Default to `any`** - Most nodes should use OR logic for flexibility
2. **Use `all` sparingly** - Only when synchronization is truly required
3. **Document custom policies** - Explain why a node needs custom logic
4. **Test loops** - Ensure conversation loops work correctly
5. **Consider edge cases** - What happens if an optional input never arrives?

## Future Enhancements

- **Timeout policies**: Execute after waiting X seconds even if inputs not ready
- **Conditional policies**: Different logic based on runtime conditions
- **Priority policies**: Execute certain inputs first
- **Partial execution**: Execute with subset of inputs, re-execute when more arrive

