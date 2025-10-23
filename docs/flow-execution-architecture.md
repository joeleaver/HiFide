# Flow Execution Architecture

## Overview

HiFide's flow execution system is a **node-controlled, lazy-evaluation architecture** where nodes are autonomous functions that control their own execution, and the scheduler is minimal glue that provides infrastructure for nodes to call each other.

## Core Principles

### 1. Nodes Are Autonomous Functions

Nodes are like pure functions with side effects:
- **Nodes control their own execution logic** - they decide when they're "done"
- **Nodes decide when to pull inputs** - not the scheduler
- **Nodes decide when to call successors** - not the scheduler
- **Nodes can read/write to the main store** - for caching, state management, cycle prevention

### 2. Scheduler Is Minimal Glue

The scheduler provides infrastructure but makes NO decisions:
- ✅ Provides a registry/router for nodes to call each other
- ✅ Tracks flow definition (nodes, edges, config)
- ✅ Provides pull/push mechanisms for nodes to use
- ❌ Does NOT eagerly pull inputs
- ❌ Does NOT cache results (nodes do this via store if needed)
- ❌ Does NOT prevent cycles (nodes do this via store if needed)
- ❌ Does NOT decide when a node is "done"

### 3. Lazy Evaluation

Inputs are pulled on-demand:
- Nodes receive **pull functions**, not resolved values
- Nodes call `await inputs.pull('inputName')` when they need an input
- Pulls travel up the chain naturally
- Nodes can check cache/config before pulling (enabling cache nodes)

## Node Behavior

### Inputs
- Node has input handles (e.g., `data`, `context`, `tools`)
- Node may have local config fields that override inputs
- **Node decides** when it needs an input value
- **Node decides** whether to use local config or pull from connected input
- **Node pulls** by calling `await inputs.pull('inputName')`

### Execution
- Node's main function executes its logic
- Node determines when it's "done" based on its own logic
- Different nodes have different "done" conditions:
  - `cache`: checks cache first, only pulls if cache miss
  - `llmRequest`: waits for streaming to complete
  - `userInput`: waits for user to provide input (breaks loops naturally)

### Outputs
- When node is done, **node calls its successors**
- Node pushes its output values to successors
- **Node controls** which successors to call and when

### Store Access
- Nodes can read/write to main store for:
  - **Caching**: Store expensive results (cache node)
  - **Cycle prevention**: Track executing nodes to prevent infinite loops
  - **State management**: Share state across nodes
  - **Persistence**: Save data that survives flow restarts

## Flow API

Nodes communicate with the system through a standardized **FlowAPI** interface. This provides all the infrastructure nodes need without coupling them to implementation details.

```typescript
interface FlowAPI {
  // Identity
  nodeId: string
  requestId: string

  // Cancellation
  signal: AbortSignal
  checkCancelled: () => void  // Throws if cancelled

  // Store access (full store)
  store: ReturnType<typeof useMainStore.getState>

  // Context management API (centralized, immutable)
  context: ContextAPI

  // Conversation/UI updates
  conversation: {
    streamChunk: (chunk: string) => void
    addBadge: (badge: Badge) => string  // Returns badge ID
    updateBadge: (badgeId: string, updates: Partial<Badge>) => void
  }

  // Logging (to flow debug window)
  log: {
    debug: (message: string, data?: any) => void
    info: (message: string, data?: any) => void
    warn: (message: string, data?: any) => void
    error: (message: string, data?: any) => void
  }

  // Tool execution (wrapped llmService)
  tools: {
    execute: (toolName: string, args: any) => Promise<any>
    list: () => Tool[]
  }

  // Usage/cost reporting
  usage: {
    report: (usage: {
      provider: string
      model: string
      inputTokens: number
      outputTokens: number
      // Cost calculated by API layer
    }) => void
  }

  // User input (for userInput node)
  waitForUserInput: () => Promise<string>
}
```

### Context API

The ContextAPI provides centralized, immutable context management:

```typescript
interface ContextAPI {
  // Create new context
  create: (params: {
    provider: string
    model: string
    systemInstructions?: string
  }) => MainFlowContext

  // Update context (immutable - returns new context)
  update: (
    context: MainFlowContext,
    updates: Partial<MainFlowContext>
  ) => MainFlowContext

  // Add single message (immutable - returns new context)
  addMessage: (
    context: MainFlowContext,
    role: 'user' | 'assistant',
    content: string,
    options?: {
      id?: string           // For idempotency
      pinned?: boolean      // Pin to top during windowing
      priority?: number     // Priority for pinned messages (default: 50)
    }
  ) => MainFlowContext

  // Add multiple messages (immutable - returns new context)
  addMessages: (
    context: MainFlowContext,
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      id?: string
      pinned?: boolean
      priority?: number
    }>
  ) => MainFlowContext

  // Inject message pair (for injectMessages node)
  injectPair: (
    context: MainFlowContext,
    userMessage: string,
    assistantMessage: string,
    options?: {
      mode?: 'prepend' | 'append'  // Default: 'prepend'
      pinned?: boolean              // Default: false
      priority?: number             // Default: 50
      idPrefix?: string             // For generating message IDs
    }
  ) => MainFlowContext

  // Remove messages by ID (for future use)
  removeMessages: (
    context: MainFlowContext,
    messageIds: string[]
  ) => MainFlowContext

  // Update message by ID (for future use)
  updateMessage: (
    context: MainFlowContext,
    messageId: string,
    updates: { content?: string; pinned?: boolean; priority?: number }
  ) => MainFlowContext
}
```

## Context Types and Store Sync

We distinguish two execution context types. If `contextType` is omitted, treat it as `main`.

- `main`: The primary conversation context for the current session
- `isolated`: A separate, parallel conversation context (e.g., branch experimentation)

Producers:
- `defaultContextStart` MUST output `contextType: 'main'`
- `newContext` MUST output `contextType: 'isolated'`

Scheduler rules:
- Contexts are immutable; the scheduler never mutates a context object in-place.
- For main contexts, the scheduler ensures provider/model reflect the current session’s settings; isolated contexts keep their own provider/model.
- UI sync:
  - Calls `feUpdateMainFlowContext(context)` for both main and isolated contexts so they appear in the inspector (isolated contexts appear as separate tabs).
  - Session persistence: only the scheduler syncs from its ExecutionContext to `Session.currentContext` (debounced). Nothing else should write to `Session.currentContext` directly.

Passing context through the graph:
- Context MUST be passed explicitly via edges. There is never an implicit fallback to a global/main context when a context edge exists.
- The scheduler prioritizes starting successors that receive `context` to improve the odds that dependent pulls find a running producer.
- Nodes may pull context only when there is exactly one incoming `context` edge and it hasn’t been pushed yet. When multiple edges target the same input, PULL is forbidden (see Ambiguity rules below), but PUSH is always allowed.


## Node Function Signature

```typescript
type NodeFunction = (
  flow: FlowAPI,                  // System API (same for all nodes)
  context: MainFlowContext,       // Flow data (different per node)
  dataIn: any | undefined,        // Data pushed from predecessor (if any)
  inputs: {
    pull: (inputName: string) => Promise<any>  // Lazy pull function
    has: (inputName: string) => boolean         // Check if input was pushed
  },
  config: Record<string, any>     // Node configuration
) => Promise<NodeOutput>
```

### Parameters

1. **`flow`**: FlowAPI instance providing:
   - Identity (nodeId, requestId)
   - Cancellation (signal, checkCancelled)
   - Store access (full store)
   - Context management (ContextAPI)
   - Conversation updates (streaming, badges)
   - Logging (debug window)
   - Tool execution
   - Usage reporting
   - User input waiting

2. **`context`**: Execution context containing:
   - `contextId`: Unique identifier for this context
   - `provider`: LLM provider ('openai', 'anthropic', 'gemini')
   - `model`: Model name
   - `systemInstructions`: System prompt
   - `messageHistory`: Conversation history
   - Note: Different nodes can receive different contexts

3. **`dataIn`**: Simple data value pushed from predecessor
   - `undefined` if node was pulled (not pushed to)
   - Contains the value if node was pushed to

4. **`inputs`**: Lazy input accessor
   - `pull(inputName)`: Pulls from connected input, returns Promise
   - `has(inputName)`: Checks if input was pushed (synchronous)

5. **`config`**: Node configuration
   - Contains node-specific config fields
   - No longer needs `_nodeId` (available via `flow.nodeId`)

### Return Value

```typescript
interface NodeOutput {
  // Context output - REQUIRED for most nodes
  context?: MainFlowContext

  // Data output - OPTIONAL
  data?: any

  // Tools output - OPTIONAL (only for tools node)
  tools?: any[]

  // Status - REQUIRED
  status: 'success' | 'error' | 'skipped'

  // Error message if status is 'error'
  error?: string

  // Execution metadata - OPTIONAL
  metadata?: {
    durationMs?: number
    tokenUsage?: { input: number; output: number }
    cached?: boolean
    [key: string]: any
  }
}
```


## Canonical Naming and Edge Handles

- Node property
  - `nodeType` is the canonical node identifier. Never use `kind`.
  - In renderer graphs, `type` may mirror `nodeType` for React Flow; use `nodeType` in code and persistence.

- Edge handle names (inputs and outputs)
  - `context`, `data`, `tools`
  - If a handle name is omitted, it defaults to `context`.

- Node I/O keys
  - Outputs must use: `context`, `data`, `tools` (for tools node), `status` (`'success' | 'error' | 'skipped'`), and optional `error`, `metadata`.

- Legacy handle variants (runtime-normalized by the scheduler)
  - `contextIn` / `contextOut` / `ctx` → `context`
  - `dataIn` / `dataOut` / `value` / `output` → `data`
  - `toolsIn` / `toolsOut` → `tools`
  - Prefer the canonical names everywhere (editor, node code, saved flows) and rely on normalization only for back-compat.

- Dynamic handles (allowed)
  - Intent routing: `{intent}-context`, `{intent}-data` (e.g., `plan-context`, `execute-data`).
  - Node-specific inputs: `userMessage`, `assistantMessage` (injectMessages).
  - Avoid `...In`/`...Out`/`ctx` suffixes beyond these dynamic cases; use lowerCamelCase descriptive names.

- Tools edges are pull-only
  - The scheduler never pushes `tools` outputs; nodes pull tools when needed.

- Colors (editor)
  - See `docs/connection-colors.md`. Purple = context, Green = data, Orange = tools.

## Example Node Implementations

### Cache Node (Lazy Evaluation)

```typescript
export const cacheNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  const ttl = config.ttl ?? 300

  // Read cache from store
  const cached = flow.store.getNodeCache(flow.nodeId)

  // Check cache validity
  if (cached && isValid(cached, ttl)) {
    flow.log.debug('Cache HIT', { age: Date.now() - cached.timestamp })

    flow.conversation.addBadge({
      type: 'info',
      label: 'Using cached data',
      icon: '💾'
    })

    return {
      context,
      data: cached.data,
      status: 'success',
      metadata: { cached: true }
    }
  }

  // Cache MISS - pull from input NOW
  flow.log.debug('Cache MISS - pulling from input')
  const freshData = dataIn ?? await inputs.pull('data')

  // Store in cache
  flow.store.setNodeCache(flow.nodeId, {
    data: freshData,
    timestamp: Date.now()
  })

  return {
    context,
    data: freshData,
    status: 'success',
    metadata: { cached: false }
  }
}
```

### LLM Request Node (Streaming, Tools, Usage Reporting)

```typescript
export const llmRequestNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Check cancellation
  flow.checkCancelled()

  // Pull all connected inputs
  const message = dataIn ?? await inputs.pull('data')
  const tools = inputs.has('tools') ? await inputs.pull('tools') : undefined

  // Add badge
  const badgeId = flow.conversation.addBadge({
    type: 'info',
    label: 'Calling LLM',
    icon: '🤖'
  })

  // Execute LLM request with streaming
  let response = ''
  const stream = await llmService.chatStream(context, message, tools)

  for await (const chunk of stream) {
    flow.checkCancelled()  // Check during streaming
    response += chunk
    flow.conversation.streamChunk(chunk)
  }

  // Report usage (API layer calculates cost)
  flow.usage.report({
    provider: context.provider,
    model: context.model,
    inputTokens: stream.usage.input,
    outputTokens: stream.usage.output
  })

  // Update badge
  flow.conversation.updateBadge(badgeId, { status: 'success' })

  // Update context with new messages (immutable)
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

### User Input Node (Loop Breaker)

```typescript
export const userInputNode: NodeFunction = async (flow, context, _dataIn, _inputs, _config) => {
  flow.log.info('Waiting for user input...')

  // Wait for user input (breaks loops naturally)
  const userInput = await flow.waitForUserInput()

  flow.log.debug('Received user input', { length: userInput.length })

  return {
    context,
    data: userInput,
    status: 'success'
  }
}
```

### Inject Messages Node (Context API Usage)

```typescript
export const injectMessagesNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // Get message content (dynamic inputs override static config)
  const userMessage = inputs.has('userMessage')
    ? await inputs.pull('userMessage')
    : config.staticUserMessage

  const assistantMessage = inputs.has('assistantMessage')
    ? await inputs.pull('assistantMessage')
    : config.staticAssistantMessage

  // Validation
  if (!userMessage?.trim() || !assistantMessage?.trim()) {
    const errorMsg = !userMessage?.trim()
      ? 'User message is required and must be non-empty'
      : 'Assistant message is required and must be non-empty'

    flow.log.error('Validation failed', { errorMsg })

    return {
      context,
      status: 'error',
      error: errorMsg
    }
  }

  // Use ContextAPI to inject the pair (immutable)
  const newContext = flow.context.injectPair(
    context,
    userMessage.trim(),
    assistantMessage.trim(),
    {
      mode: config.injectionMode || 'prepend',
      pinned: config.pinned || false,
      priority: config.priority || 50,
      idPrefix: flow.nodeId  // For idempotency
    }
  )

  flow.log.debug('Injected message pair', {
    mode: config.injectionMode || 'prepend',
    pinned: config.pinned || false
  })

  return {
    context: newContext,
    data: { userMessage: userMessage.trim(), assistantMessage: assistantMessage.trim() },
    status: 'success'
  }
}
```

## Flow Execution

### Entry Points

Every flow has **exactly one entry node**: `defaultContextStart`. The scheduler explicitly looks for this node type rather than assuming nodes with no incoming edges are entry nodes.

```typescript
// Find the entry node - there should be exactly one: defaultContextStart
const entryNode = flowDef.nodes.find(n => n.type === 'defaultContextStart')

if (!entryNode) {
  throw new Error('No defaultContextStart node found in flow')
}

// Execute the entry node
await executeNode(entryNode.id, {}, null)
```

This ensures that nodes like `newContext`, `manualInput`, and `portalOutput` (which may have no incoming edges) are **not** auto-executed at flow startup. They only execute when pulled by other nodes.

### Execution Flow

1. **Entry node executes** (`defaultContextStart` - the only entry node)
2. **Node completes** and calls successors
3. **Successors execute** (pushed to with outputs)
4. **Successors may pull** from other inputs if needed
5. **Pulls travel up the chain** until reaching a node that has the data
6. **Flow continues** until reaching a `userInput` node
7. **Flow waits** at `userInput` for user interaction
8. **User provides input**, flow resumes
9. **Loop continues** indefinitely

### Push vs Pull

**Push**: Node completes and calls successors with outputs
```typescript
// Node A completes
return { context: ctx, data: result }

// Scheduler calls successors
for (const successor of successors) {
  await executeNode(successor, { data: result })
}
```

**Pull**: Node needs an input and executes the source
```typescript
// Node B needs data from Node A
const data = await inputs.pull('data')

// Scheduler executes Node A
const result = await executeNode(nodeA)
return result.data
```


### Push/Pull Contract and Scheduler Rules

- No empty pushes
  - A node only pushes to a successor when it has at least one output value mapped to that successor’s target input(s). This avoids accidental “implicit pull” behavior.

- Parallel push with context-first ordering
  - The scheduler triggers all eligible successors in parallel for responsiveness.
  - Successors that receive `context` are ordered first to improve the likelihood that dependent pulls resolve against an already-running producer.

- Ambiguity rules (multiple incoming edges to the same input)
  - Pull: forbidden. If multiple edges target the same input, `inputs.has(name)` returns `false` and `inputs.pull(name)` throws. Nodes must not attempt to pull such inputs.
  - Push: allowed. Multiple predecessors may push to the same input.
  - Start gating: If a successor has an input with multiple incoming edges and that input is not present in the coalesced pushed data, the scheduler defers starting that successor until that input is pushed (prevents an immediate forbidden pull).

- In-flight execution reuse (no duplicate starts)
  - If a successor is already executing and receives additional pushes, the scheduler feeds those values into the running execution (no new `executeNode` call).
  - NodeInputs are live: `inputs.has()`/`inputs.pull()` consult a per-execution live buffer that includes late-pushed values.
  - When pulling from a source node that is already executing, the scheduler awaits the in-flight result instead of spawning a duplicate execution.

- Tools are pull-only
  - `tools` edges never trigger pushes; nodes pull tools if/when needed.

- Defaults
  - Omitted handle names default to `context`.
  - The scheduler canonicalizes legacy handle aliases at runtime (see Canonical Naming section).

- Logging (for debugging)
  - Each node’s PUSH phase logs normalized push edges and the collected inputs per successor.
  - When deferring a start due to ambiguity, the scheduler logs the missing inputs it is waiting for.
  - When feeding an in-flight successor, the scheduler logs the keys that were added to its live input buffer.

### Special Cases

**Tools Edges**: Pull-only, never pushed
- Tools node provides static list
- LLM nodes pull tools when needed
- Tools edges don't trigger execution on completion

**Portal Nodes**: Transparent conduits
- `portalInput`: Stores data in registry, passes through
- `portalOutput`: Retrieves data from registry, passes through
- Enable non-linear flows without visual clutter

**Loops**: Handled naturally by `userInput` nodes
- Flow executes until reaching `userInput`
- `userInput` awaits user interaction (breaks loop)
- User provides input, flow continues
- No special cycle detection needed

## Migration from Current Architecture

### Current (Scheduler-Controlled)

```typescript
// Scheduler eagerly pulls ALL inputs before calling node
for (const edge of incomingEdges) {
  const value = await executeNode(edge.source)
  allInputs[edge.targetInput] = value
}

// Node receives resolved values
const result = await nodeFunction(context, dataIn, allInputs, config)
```

### New (Node-Controlled)

```typescript
// Scheduler provides pull function, doesn't pull eagerly
const pullFn = (inputName) => {
  const edge = findEdge(nodeId, inputName)
  return executeNode(edge.source)
}

// Node decides when to pull
const result = await nodeFunction(context, dataIn, { pull: pullFn }, config)
```

### Breaking Changes

1. **Node signature changes**: All nodes must be updated to use new signature
2. **Nodes must explicitly pull**: Can't access `inputs.data` directly, must call `inputs.pull('data')`
3. **Scheduler simplified**: Remove eager PULL phase, remove pullCache, remove cycle detection
4. **Store additions**: Add cache management, cycle detection helpers

## Benefits

1. **Lazy evaluation**: Expensive operations only run when needed (cache nodes work!)
2. **Node autonomy**: Nodes control their own logic, easier to understand
3. **Simpler scheduler**: Less magic, easier to debug
4. **Better caching**: Nodes can check cache before pulling
5. **Flexible execution**: Nodes can implement custom logic (conditional pulls, etc.)
6. **Natural loops**: `userInput` nodes break loops by waiting for user

## Implementation Plan

See separate implementation plan document for migration steps.

