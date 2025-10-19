# Flow Execution Architecture Migration Plan

## Overview

This document outlines the step-by-step plan to migrate from the current scheduler-controlled architecture to the new node-controlled, lazy-evaluation architecture.

## Current State

**Scheduler responsibilities:**
- Finds entry nodes and executes them
- Eagerly pulls ALL inputs before calling node function
- Caches pull results to prevent re-execution
- Prevents cycles via pullCache
- Pushes to successors after node completes

**Node responsibilities:**
- Receives resolved inputs (already pulled by scheduler)
- Executes logic
- Returns outputs

**Problem:** Nodes can't control when inputs are pulled, making cache nodes impossible.

## Target State

**Scheduler responsibilities:**
- Finds entry nodes and executes them
- Provides pull infrastructure for nodes
- Pushes to successors after node completes
- **That's it!**

**Node responsibilities:**
- Decides when to pull inputs
- Pulls inputs via `await inputs.pull('inputName')`
- Executes logic
- Manages own caching/state via store
- Returns outputs

**Benefit:** Nodes control their own execution, enabling lazy evaluation and cache nodes.

## Migration Steps

### Phase 1: Create FlowAPI and ContextAPI

**Files to create:**
- `electron/ipc/flows-v2/flow-api.ts` (FlowAPI interface and factory)
- `electron/ipc/flows-v2/context-api.ts` (ContextAPI implementation)

**Files to modify:**
- `electron/ipc/flows-v2/types.ts` (update NodeFunction signature)

**Changes:**

1. **Create `flow-api.ts`** with FlowAPI interface:
```typescript
export interface FlowAPI {
  nodeId: string
  requestId: string
  signal: AbortSignal
  checkCancelled: () => void
  store: ReturnType<typeof useMainStore.getState>
  context: ContextAPI
  conversation: {
    streamChunk: (chunk: string) => void
    addBadge: (badge: Badge) => string
    updateBadge: (badgeId: string, updates: Partial<Badge>) => void
  }
  log: {
    debug: (message: string, data?: any) => void
    info: (message: string, data?: any) => void
    warn: (message: string, data?: any) => void
    error: (message: string, data?: any) => void
  }
  tools: {
    execute: (toolName: string, args: any) => Promise<any>
    list: () => Tool[]
  }
  usage: {
    report: (usage: {
      provider: string
      model: string
      inputTokens: number
      outputTokens: number
    }) => void
  }
  waitForUserInput: () => Promise<string>
}
```

2. **Create `context-api.ts`** with ContextAPI implementation:
```typescript
export interface ContextAPI {
  create: (params: { provider: string; model: string; systemInstructions?: string }) => MainFlowContext
  update: (context: MainFlowContext, updates: Partial<MainFlowContext>) => MainFlowContext
  addMessage: (context: MainFlowContext, role: 'user' | 'assistant', content: string, options?: {...}) => MainFlowContext
  addMessages: (context: MainFlowContext, messages: Array<{...}>) => MainFlowContext
  injectPair: (context: MainFlowContext, userMessage: string, assistantMessage: string, options?: {...}) => MainFlowContext
  removeMessages: (context: MainFlowContext, messageIds: string[]) => MainFlowContext
  updateMessage: (context: MainFlowContext, messageId: string, updates: {...}) => MainFlowContext
}

export function createContextAPI(): ContextAPI {
  // Implementation of all methods
}
```

3. **Update `types.ts`** with new NodeFunction signature:
```typescript
// OLD
export type NodeFunction = (
  context: MainFlowContext,
  dataIn: any,
  inputs: Record<string, any>,
  config: Record<string, any>
) => Promise<NodeOutput>

// NEW
export interface NodeInputs {
  pull: (inputName: string) => Promise<any>
  has: (inputName: string) => boolean
}

export type NodeFunction = (
  flow: FlowAPI,
  context: MainFlowContext,
  dataIn: any | undefined,
  inputs: NodeInputs,
  config: Record<string, any>
) => Promise<NodeOutput>
```

**Estimated time:** 2-3 hours

### Phase 2: Update Scheduler

**Files to modify:**
- `electron/ipc/flows-v2/scheduler.ts`

**Changes:**

1. **Add FlowAPI factory method**:
```typescript
private createFlowAPI(nodeId: string): FlowAPI {
  return {
    nodeId,
    requestId: this.requestId,
    signal: this.abortController.signal,
    checkCancelled: () => {
      if (this.abortController.signal.aborted) {
        throw new Error('Flow execution cancelled')
      }
    },
    store: useMainStore.getState(),
    context: createContextAPI(),
    conversation: {
      streamChunk: (chunk) => this.emitChunk(chunk),
      addBadge: (badge) => this.addBadge(nodeId, badge),
      updateBadge: (id, updates) => this.updateBadge(id, updates)
    },
    log: {
      debug: (msg, data) => this.emitLog('debug', nodeId, msg, data),
      info: (msg, data) => this.emitLog('info', nodeId, msg, data),
      warn: (msg, data) => this.emitLog('warn', nodeId, msg, data),
      error: (msg, data) => this.emitLog('error', nodeId, msg, data)
    },
    tools: {
      execute: (name, args) => this.executeTool(name, args),
      list: () => this.getAvailableTools()
    },
    usage: {
      report: (usage) => this.reportUsage(usage)
    },
    waitForUserInput: () => this.waitForUserInput(nodeId)
  }
}
```

2. **Remove eager PULL phase** (lines 230-266):
   - Delete the loop that pulls all inputs before calling node
   - Keep the edge tracking (incomingEdges, outgoingEdges)

3. **Create pull function** for nodes:
```typescript
private createPullFunction(nodeId: string): (inputName: string) => Promise<any> {
  return async (inputName: string) => {
    const incomingEdges = this.incomingEdges.get(nodeId) || []
    const edge = incomingEdges.find(e => e.targetInput === inputName)

    if (!edge) {
      throw new Error(`No edge found for input '${inputName}' on node '${nodeId}'`)
    }

    // Execute source node to get the value
    const sourceResult = await this.executeNode(edge.source, {}, nodeId)

    // Extract the specific output
    if (edge.sourceOutput in sourceResult) {
      return (sourceResult as any)[edge.sourceOutput]
    }

    return undefined
  }
}
```

4. **Create has function** for nodes:
```typescript
private createHasFunction(pushedInputs: Record<string, any>): (inputName: string) => boolean {
  return (inputName: string) => inputName in pushedInputs
}
```

5. **Update node execution** to pass FlowAPI and pull/has functions:
```typescript
// Create FlowAPI instance
const flowAPI = this.createFlowAPI(nodeId)

// Create inputs object with pull/has functions
const inputs: NodeInputs = {
  pull: this.createPullFunction(nodeId),
  has: this.createHasFunction(pushedInputs)
}

// Call node function with new signature
const result = await nodeFunction(flowAPI, contextIn, dataIn, inputs, config)
```

6. **Remove pullCache** (lines 49, 183-203):
   - Delete `private pullCache` field
   - Delete cache check/set logic
   - Nodes handle their own caching via store

7. **Remove pullPromises** (lines 52, 168-180, 193-198):
   - Delete `private pullPromises` field
   - Delete duplicate execution prevention
   - Nodes handle cycle prevention via store if needed

8. **Keep PUSH phase** (lines 361-406):
   - No changes needed
   - Nodes still push to successors after completion

9. **Add helper methods** for FlowAPI:
   - `emitChunk()`, `addBadge()`, `updateBadge()`
   - `emitLog()`, `executeTool()`, `getAvailableTools()`
   - `reportUsage()`, `waitForUserInput()`

**Estimated time:** 4-5 hours

### Phase 3: Add Store Helpers

**Files to modify:**
- `electron/store/slices/session.slice.ts` (or create new `flowExecution.slice.ts`)

**Changes:**

1. **Add node cache management**:
```typescript
interface NodeCache {
  data: any
  timestamp: number
}

interface SessionSlice {
  // ... existing fields ...
  
  // Node cache (per session, per node)
  nodeCache: Record<string, NodeCache>
  
  // Actions
  getNodeCache: (nodeId: string) => NodeCache | undefined
  setNodeCache: (nodeId: string, cache: NodeCache) => void
  clearNodeCache: (nodeId: string) => void
}
```

2. **Add cycle detection helpers** (optional):
```typescript
interface SessionSlice {
  // ... existing fields ...
  
  // Track executing nodes
  executingNodes: Set<string>
  
  // Actions
  isNodeExecuting: (nodeId: string) => boolean
  markNodeExecuting: (nodeId: string) => void
  markNodeComplete: (nodeId: string) => void
}
```

**Estimated time:** 1 hour

### Phase 4: Update All Nodes

**Files to modify:** All node files in `electron/ipc/flows-v2/nodes/`

**Node list:**
1. `cache.ts` ✅ (already partially updated)
2. `defaultContextStart.ts`
3. `injectMessages.ts`
4. `intentRouter.ts`
5. `llmRequest.ts`
6. `manualInput.ts`
7. `newContext.ts`
8. `portalInput.ts`
9. `portalOutput.ts`
10. `tools.ts`
11. `userInput.ts`

**For each node:**

1. Update signature to match new `NodeFunction` type
2. Replace `inputs.fieldName` with `await inputs.pull('fieldName')`
3. Use `inputs.has('fieldName')` to check if input was pushed
4. Update logic to handle lazy evaluation

**Example migration:**

```typescript
// OLD
export const llmRequestNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const message = dataIn || ''
  const tools = inputs.tools  // Already resolved by scheduler

  // Call LLM
  const response = await llmService.chat(contextIn, message, tools)

  // Update context manually
  return {
    context: {
      ...contextIn,
      messageHistory: [...contextIn.messageHistory, { role: 'user', content: message }, { role: 'assistant', content: response }]
    },
    data: response,
    status: 'success'
  }
}

// NEW
export const llmRequestNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Check cancellation
  flow.checkCancelled()

  // Pull inputs lazily
  const message = dataIn ?? await inputs.pull('data')
  const tools = inputs.has('tools') ? await inputs.pull('tools') : undefined

  // Add badge
  const badgeId = flow.conversation.addBadge({
    type: 'info',
    label: 'Calling LLM',
    icon: '🤖'
  })

  // Stream response
  let response = ''
  const stream = await llmService.chatStream(context, message, tools)

  for await (const chunk of stream) {
    flow.checkCancelled()
    response += chunk
    flow.conversation.streamChunk(chunk)
  }

  // Report usage
  flow.usage.report({
    provider: context.provider,
    model: context.model,
    inputTokens: stream.usage.input,
    outputTokens: stream.usage.output
  })

  // Update badge
  flow.conversation.updateBadge(badgeId, { status: 'success' })

  // Update context using ContextAPI (immutable)
  const newContext = flow.context.addMessages(context, [
    { role: 'user', content: message },
    { role: 'assistant', content: response }
  ])

  return {
    context: newContext,
    data: response,
    status: 'success'
  }
}
```

**Estimated time:** 6-8 hours (40-60 min per node)

### Phase 5: Update Tests

**Files to modify:**
- Any test files that call node functions directly
- Integration tests for flow execution

**Changes:**
1. Update test mocks to provide pull/has functions
2. Update assertions for new behavior
3. Add tests for lazy evaluation (cache node especially)

**Estimated time:** 2-3 hours

### Phase 6: Update Documentation

**Files to modify:**
- `electron/ipc/flows-v2/scheduler.ts` (header comment)
- `README.md` (if it mentions flow execution)
- Any other docs that reference the old architecture

**Changes:**
1. Update scheduler header comment to reflect new architecture
2. Remove references to "scheduler pulls inputs"
3. Add references to "nodes pull inputs"

**Estimated time:** 30 minutes

## Detailed Node Migration Guide

### Pattern 1: Simple Pass-Through Node

**Before:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  return {
    context: contextIn,
    data: dataIn,
    status: 'success'
  }
}
```

**After:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // No changes needed - doesn't use inputs
  return {
    context: contextIn,
    data: dataIn,
    status: 'success'
  }
}
```

### Pattern 2: Node That Uses Single Input

**Before:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const tools = inputs.tools  // Already resolved
  // ... use tools
}
```

**After:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const tools = await inputs.pull('tools')  // Pull on-demand
  // ... use tools
}
```

### Pattern 3: Node With Optional Input

**Before:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const tools = inputs.tools || []  // Use default if not provided
  // ... use tools
}
```

**After:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const tools = inputs.has('tools') ? await inputs.pull('tools') : []
  // ... use tools
}
```

### Pattern 4: Node With Config Override

**Before:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const message = config.message || dataIn || inputs.data
  // ... use message
}
```

**After:**
```typescript
export const myNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Check config first, then dataIn, then pull
  const message = config.message || dataIn || await inputs.pull('data')
  // ... use message
}
```

### Pattern 5: Cache Node (Conditional Pull)

**Before:**
```typescript
export const cacheNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Can't check cache before scheduler pulls inputs!
  const freshData = dataIn ?? inputs.data  // Already pulled by scheduler
  // ... cache logic
}
```

**After:**
```typescript
export const cacheNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const nodeId = config._nodeId
  const store = useMainStore.getState()
  const cached = store.getNodeCache(nodeId)
  
  // Check cache BEFORE pulling
  if (cached && isValid(cached)) {
    return { context: contextIn, data: cached.data, status: 'success' }
  }
  
  // Cache miss - NOW pull
  const freshData = dataIn ?? await inputs.pull('data')
  store.setNodeCache(nodeId, { data: freshData, timestamp: Date.now() })
  
  return { context: contextIn, data: freshData, status: 'success' }
}
```

## Testing Strategy

### Unit Tests

For each node:
1. Test with pushed data (dataIn provided)
2. Test with pulled data (dataIn undefined, must pull)
3. Test with config override (config takes precedence)
4. Test with missing optional inputs

### Integration Tests

1. Test simple linear flow (A → B → C)
2. Test flow with cache node (cache hit vs miss)
3. Test flow with loops (userInput breaks loop)
4. Test flow with tools (pull-only edges)
5. Test flow with portals (non-linear flow)

### Manual Testing

1. Run existing flows and verify they work
2. Test cache invalidation button
3. Test flow with expensive operations (verify lazy evaluation)
4. Test loops (verify no infinite loops)

## Rollback Plan

If migration fails:
1. Revert all node changes
2. Revert scheduler changes
3. Revert type definition changes
4. Keep store helpers (they're additive, won't break anything)

Git strategy:
- Create feature branch: `feature/node-controlled-execution`
- Commit each phase separately
- Test thoroughly before merging
- Keep old architecture in git history for reference

## Timeline Estimate

- Phase 1 (FlowAPI + ContextAPI + Types): 2-3 hours
- Phase 2 (Scheduler): 4-5 hours
- Phase 3 (Store): 1 hour
- Phase 4 (Nodes): 6-8 hours
- Phase 5 (Tests): 2-3 hours
- Phase 6 (Docs): 30 min

**Total: 15-20 hours** (2-3 days of focused work)

## Success Criteria

- ✅ All existing flows work correctly
- ✅ Cache node prevents expensive operations when cache is valid
- ✅ Loops work without infinite execution
- ✅ Tools are pulled correctly by LLM nodes
- ✅ All tests pass
- ✅ No performance regression
- ✅ Code is cleaner and easier to understand

## Next Steps

1. Review this plan with team
2. Create feature branch
3. Start with Phase 1 (types)
4. Proceed through phases sequentially
5. Test thoroughly after each phase
6. Merge when all phases complete and tests pass

