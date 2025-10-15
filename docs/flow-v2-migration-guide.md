# Flow Engine V2 - Migration Guide

## Overview

Flow Engine V2 is a complete rewrite of the flow execution system with a clean, function-based architecture. This guide will help you understand what changed and how to migrate.

---

## What Changed

### ✅ Improvements

1. **10x Simpler Code**: ~400 lines vs ~1400 lines
2. **Explicit Data Flow**: Can trace exactly what data flows where
3. **Better Debugging**: Comprehensive logging of inputs/outputs/decisions
4. **Easier Testing**: Nodes are pure functions
5. **No Magic**: No implicit behavior or hidden state
6. **Hybrid Pull-Push**: Industry-standard execution model

### ⚠️ Breaking Changes

1. **IPC Handlers Changed**:
   - `flow:run` → `flow:run:v2`
   - `flow:resume` → `flow:resume:v2`
   - `flow:stop` → `flow:cancel:v2`

2. **Removed Features** (not implemented in V2 yet):
   - `flow:init` - Use `flow:run:v2` instead
   - `flow:pause` - Flows pause automatically at userInput nodes
   - `flow:step` - Not implemented
   - `flow:setBreakpoints` - Not implemented

3. **Edge Format**: Edges now use explicit `sourceOutput`/`targetInput` instead of just handles
   - Old: `{ source, target, sourceHandle, targetHandle }`
   - New: `{ source, target, sourceOutput, targetInput }`
   - **Compatibility**: V2 automatically converts old format to new format

---

## Migration Steps

### 1. Update Frontend Code

The preload layer has been updated to use V2 handlers automatically. No frontend changes needed unless you're calling IPC directly.

**If you're calling IPC directly:**

```typescript
// OLD
await window.flowExec.run({ requestId, flowDef, provider, model })

// NEW (same API, different backend)
await window.flowExec.run({ requestId, flowDef, provider, model })
```

The API is the same, but it now calls `flow:run:v2` under the hood.

### 2. Update Flow Definitions (Optional)

V2 automatically converts old edge format to new format, so existing flows will work. However, for new flows, you can use the explicit format:

```typescript
// OLD (still works)
{
  id: 'e1',
  source: 'tools',
  target: 'chat',
  sourceHandle: 'tools',
  targetHandle: 'tools'
}

// NEW (explicit)
{
  id: 'e1',
  source: 'tools',
  target: 'chat',
  sourceOutput: 'tools',  // Explicit output name
  targetInput: 'tools'     // Explicit input name
}
```

### 3. Remove Deprecated Features

If you're using these features, they need to be replaced:

**flow:init** → Use `flow:run:v2` instead
```typescript
// OLD
await window.flowExec.init({ requestId, flowDef })
await window.flowExec.run({ requestId, input: userMessage })

// NEW
await window.flowExec.run({ requestId, flowDef, input: userMessage })
```

**flow:pause** → Flows pause automatically at userInput nodes
```typescript
// OLD
await window.flowExec.pause(requestId)

// NEW
// No manual pause needed - userInput nodes pause automatically
```

**flow:setBreakpoints** → Not implemented in V2
```typescript
// OLD
await window.flowExec.setBreakpoints({ requestId, nodeIds: ['node1', 'node2'] })

// NEW
// Not available in V2 - use logging instead
```

---

## Testing Your Migration

### 1. Run Existing Flows

Try running your existing flows with V2. They should work without changes.

### 2. Check Logs

V2 has much better logging. Check the flow events for detailed execution traces:

```
[Flow V2] Starting execution
[Entry Nodes] defaultContextStart, tools
[Executing] defaultContextStart
[Pull Phase] defaultContextStart checking dependencies...
[Dependencies] defaultContextStart has no dependencies
[Inputs] (none)
[Context] main (openai/gpt-5, 0 messages)
[Outputs] result=started
[Completed] defaultContextStart in 5ms
[Push Phase] defaultContextStart propagating outputs...
[Ready] userInput
...
```

### 3. Test Pause/Resume

Test flows with userInput nodes to ensure pause/resume works:

```typescript
// Start flow
await window.flowExec.run({ requestId, flowDef, provider, model })

// Flow will pause at userInput node
// Listen for pause event
window.flowExec.onEvent((ev) => {
  if (ev.type === 'io' && ev.data?.includes('[Flow Paused]')) {
    console.log('Flow paused, waiting for user input')
  }
})

// Resume with user input
await window.flowExec.resume(requestId, 'user message here')
```

---

## Troubleshooting

### Flow Not Starting

**Symptom**: Flow doesn't execute any nodes

**Solution**: Check that you have entry nodes (nodes with no incoming edges). V2 starts execution from entry nodes.

### Tools Not Passed to Chat

**Symptom**: Chat node doesn't receive tools

**Solution**: Check edge routing. Tools should flow from tools node to chat node:
```typescript
{
  source: 'tools',
  sourceOutput: 'tools',  // or sourceHandle: 'tools'
  target: 'chat',
  targetInput: 'tools'     // or targetHandle: 'tools'
}
```

### Flow Not Pausing

**Symptom**: Flow doesn't pause at userInput node

**Solution**: Ensure userInput node is properly connected and returns `status: 'paused'`. Check logs for execution trace.

### Circular Dependency Error

**Symptom**: Error: "Circular dependency detected at node X"

**Solution**: Check your flow graph for cycles. V2 detects and prevents circular dependencies.

---

## New Features in V2

### 1. Comprehensive Logging

Every node execution is logged with:
- Dependencies checked
- Inputs received
- Context state
- Outputs produced
- Execution time
- Push/pull decisions

### 2. Memoization

Nodes execute once and cache results. If multiple nodes depend on the same source, the source only executes once.

### 3. Automatic Join Handling

Nodes with multiple inputs automatically wait for all inputs before executing. No manual synchronization needed.

### 4. Better Error Messages

Errors include:
- Which node failed
- What inputs it received
- What the error was
- Full execution trace

---

## Performance

V2 is designed to be more efficient:

- **Memoization**: Nodes execute once, results cached
- **Lazy Evaluation**: Only executes nodes that are needed
- **Parallel Execution**: Independent branches can execute in parallel (future enhancement)

---

## Future Enhancements

Planned for future versions:

- [ ] Parallel execution of independent branches
- [ ] Breakpoint support
- [ ] Step-through debugging
- [ ] Flow visualization with execution state
- [ ] Performance profiling
- [ ] newContext node support
- [ ] errorDetection node support
- [ ] intentRouter node support

---

## Getting Help

If you encounter issues:

1. Check the logs - V2 has comprehensive logging
2. Verify edge routing - use explicit sourceOutput/targetInput
3. Check for circular dependencies
4. Review the execution trace in flow events

For bugs or feature requests, file an issue with:
- Flow definition (JSON)
- Expected behavior
- Actual behavior
- Execution logs

