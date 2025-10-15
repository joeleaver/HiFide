# Flow Execution Engine Refactor

## Overview

Refactor the flow execution engine from implicit data flow with complex state maps to explicit function-based execution with named inputs/outputs.

## Current Problems

1. **Overly complex state management**: `predVals`, `nextInput`, `started`, `executing`, `inCount`, `remInCount`, `outMap`, `contextInMap`, `dataInMap`, `toolsInMap`
2. **Implicit data flow**: Hard to trace what data goes where
3. **Mixed concerns**: Context propagation, data flow, and execution scheduling all tangled together
4. **Difficult debugging**: Can't easily see what inputs a node receives or what outputs it produces
5. **Hard to test**: Nodes aren't isolated functions, they're embedded in execution logic

## New Design

### Core Principle
**Nodes are pure functions with named inputs and outputs. Edges explicitly map outputs to inputs.**

---

## 1. ExecutionContext Type

The most important type in the system. Represents the execution environment for a node.

```typescript
/**
 * ExecutionContext - The execution environment for a node
 * 
 * This is the primary object passed through the flow execution.
 * It contains everything a node needs to execute and communicate with LLMs.
 */
interface ExecutionContext {
  /**
   * Unique identifier for this context (e.g., 'main', or a newContext node ID)
   * Multiple nodes can share the same context to maintain conversation continuity.
   */
  contextId: string

  /**
   * AI provider for this context (e.g., 'openai', 'anthropic', 'gemini')
   * Determines which LLM API to use.
   */
  provider: string

  /**
   * Model identifier (e.g., 'gpt-5', 'claude-3-3-sonnet', 'gemini-1.5-pro')
   * Specific model within the provider to use.
   */
  model: string

  /**
   * Optional system instructions for this context
   * Sent as the first message to guide the LLM's behavior.
   * Only sent once at the start of a conversation.
   */
  systemInstructions?: string

  /**
   * Conversation history for this context
   * Shared across all nodes using the same contextId.
   * 
   * For OpenAI/Gemini: Only used for tracking, actual history managed server-side via sessionId
   * For Anthropic: Sent with every request (no server-side session management)
   */
  messageHistory: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>

  /**
   * Session ID for provider-native session management
   * Used by OpenAI and Gemini to maintain server-side conversation state.
   * Allows sending only the current message instead of full history.
   * 
   * Format: `${contextId}` (same as contextId for simplicity)
   */
  sessionId: string

  /**
   * Current output value from the most recent node in this context
   * Used for context propagation - when a node passes context to the next node,
   * this contains the output that should be used as input.
   */
  currentOutput: string
}
```

**Lifecycle:**
1. **Initialization**: Created at flow start for 'main' context and when newContext nodes are encountered
2. **Propagation**: Passed from node to node via context edges
3. **Mutation**: Nodes can add messages to messageHistory and update currentOutput
4. **Isolation**: Each contextId has independent messageHistory

---

## 2. Node Function Interface

```typescript
/**
 * NodeOutput - What a node returns after execution
 */
interface NodeOutput {
  /**
   * Named outputs from this node
   * Keys are output names (e.g., 'result', 'tools', 'error')
   * Values are the actual output data
   * 
   * Example:
   * {
   *   result: "Hello, world!",
   *   metadata: { tokenCount: 42 }
   * }
   */
  outputs: Record<string, any>

  /**
   * Updated execution context
   * If the node modified the context (e.g., added messages to history),
   * return the updated context here.
   * 
   * If context wasn't modified, return the original context.
   */
  updatedContext: ExecutionContext

  /**
   * Optional execution metadata
   * Used for debugging, logging, and monitoring
   */
  metadata?: {
    durationMs?: number
    tokenUsage?: { input: number; output: number }
    cached?: boolean
    [key: string]: any
  }

  /**
   * Optional execution status
   * Used for special control flow (e.g., pausing for user input)
   */
  status?: 'success' | 'paused' | 'error'
}

/**
 * NodeFunction - The signature for all node implementations
 */
type NodeFunction = (
  inputs: Record<string, any>,
  context: ExecutionContext,
  config: Record<string, any>
) => Promise<NodeOutput>
```

**Example Node Implementation:**

```typescript
// Chat node
async function chatNode(
  inputs: Record<string, any>,
  context: ExecutionContext,
  config: Record<string, any>
): Promise<NodeOutput> {
  const message = inputs.message || inputs.data || ''
  const tools = inputs.tools // Optional tools from tools node
  
  // Add user message to context history
  context.messageHistory.push({ role: 'user', content: message })
  
  // Call LLM
  const response = await callLLM(context, tools)
  
  // Add assistant response to context history
  context.messageHistory.push({ role: 'assistant', content: response })
  
  // Update context output
  context.currentOutput = response
  
  return {
    outputs: {
      result: response,
      context: context // Pass context to next node
    },
    updatedContext: context,
    status: 'success'
  }
}

// UserInput node
async function userInputNode(
  inputs: Record<string, any>,
  context: ExecutionContext,
  config: Record<string, any>
): Promise<NodeOutput> {
  // This node pauses execution and waits for user input
  // The scheduler will save state and wait for resume
  
  return {
    outputs: {
      // Output will be set when resumed with user input
    },
    updatedContext: context,
    status: 'paused' // Special status tells scheduler to pause
  }
}

// Tools node
async function toolsNode(
  inputs: Record<string, any>,
  context: ExecutionContext,
  config: Record<string, any>
): Promise<NodeOutput> {
  const toolsConfig = config.tools || 'auto'
  const allTools = globalThis.__agentTools || []
  
  let selectedTools = []
  if (toolsConfig === 'auto') {
    selectedTools = allTools
  } else if (Array.isArray(toolsConfig)) {
    selectedTools = allTools.filter(t => toolsConfig.includes(t.name))
  }
  
  return {
    outputs: {
      tools: selectedTools, // Actual tool objects
      toolNames: selectedTools.map(t => t.name) // For display
    },
    updatedContext: context,
    status: 'success'
  }
}
```

---

## 3. Edge Specification

```typescript
/**
 * Edge - Explicit connection between node outputs and inputs
 */
interface Edge {
  id: string
  source: string // Source node ID
  sourceOutput: string // Output name from source node (e.g., 'result', 'tools', 'context')
  target: string // Target node ID
  targetInput: string // Input name for target node (e.g., 'message', 'tools', 'data')
  
  /**
   * Optional metadata for special edge types
   */
  metadata?: {
    isContextEdge?: boolean // True if this edge propagates execution context
    [key: string]: any
  }
}
```

**Special Edge Types:**

1. **Context Edges**: `sourceOutput: 'context'` → `targetInput: 'context'`
   - Propagates ExecutionContext from source to target
   - Creates execution dependency
   - Target inherits source's context (provider, model, messageHistory)

2. **Data Edges**: `sourceOutput: 'result'` → `targetInput: 'message'`
   - Passes only the output value
   - Creates execution dependency
   - No context propagation

3. **Tools Edges**: `sourceOutput: 'tools'` → `targetInput: 'tools'`
   - Passes tool objects to chat nodes
   - Creates execution dependency
   - No context propagation

**Example Flow:**
```
defaultContextStart
  ↓ (context edge: context → context)
userInput
  ↓ (context edge: context → context)
chat ← (tools edge: tools → tools) ← tools
  ↓ (context edge: context → context)
userInput
```

---

## 4. Execution Scheduler

### The Core Problem: When is a Node Ready?

A node is ready to execute when **all its required inputs are available**. This is a classic dataflow problem with two main solutions:

1. **Push Model**: When a node completes, push outputs to successors. Execute when all inputs received.
2. **Pull Model**: When you need a node's output, recursively execute all dependencies first.

We use a **hybrid approach**: **Demand-driven with push propagation**

### Execution Strategy

```typescript
class FlowScheduler {
  // State
  private nodeInputs: Map<string, Record<string, any>> = new Map()
  private nodeOutputs: Map<string, Record<string, any>> = new Map()
  private nodeContexts: Map<string, ExecutionContext> = new Map()
  private executionState: Map<string, 'pending' | 'executing' | 'completed' | 'paused'> = new Map()

  // Graph structure (computed once)
  private incomingEdges: Map<string, Edge[]> = new Map()
  private outgoingEdges: Map<string, Edge[]> = new Map()
  private requiredInputs: Map<string, Set<string>> = new Map() // nodeId -> set of required input names

  async execute(flowDef: FlowDefinition): Promise<void> {
    // 1. Build graph structure
    this.buildGraphStructure(flowDef)

    // 2. Initialize contexts
    this.initializeContexts(flowDef)

    // 3. Find entry points (nodes with no incoming edges)
    const entryNodes = this.findEntryNodes(flowDef)

    // 4. Execute entry nodes (they will trigger downstream execution)
    for (const nodeId of entryNodes) {
      await this.executeNode(nodeId, flowDef)
    }
  }

  /**
   * Execute a node and propagate outputs to successors
   * Uses memoization - if already executed, return cached result
   */
  private async executeNode(nodeId: string, flowDef: FlowDefinition): Promise<NodeOutput> {
    // Check if already completed
    if (this.executionState.get(nodeId) === 'completed') {
      return { outputs: this.nodeOutputs.get(nodeId)!, updatedContext: this.nodeContexts.get(nodeId)!, status: 'success' }
    }

    // Check if already executing (circular dependency)
    if (this.executionState.get(nodeId) === 'executing') {
      throw new Error(`Circular dependency detected at node ${nodeId}`)
    }

    // Mark as executing
    this.executionState.set(nodeId, 'executing')

    // PULL: Ensure all dependencies are executed first
    await this.ensureDependenciesReady(nodeId, flowDef)

    // Collect inputs from incoming edges
    const inputs = this.collectInputs(nodeId)
    const context = this.nodeContexts.get(nodeId) || this.createDefaultContext()
    const config = this.getNodeConfig(nodeId, flowDef)

    // Execute the node function
    const nodeFunction = this.getNodeFunction(nodeId, flowDef)
    const result = await nodeFunction(inputs, context, config)

    // Handle pause (e.g., userInput)
    if (result.status === 'paused') {
      this.executionState.set(nodeId, 'paused')
      await this.handlePause(nodeId, result)
      // After resume, continue execution
    }

    // Store outputs and updated context
    this.nodeOutputs.set(nodeId, result.outputs)
    this.nodeContexts.set(nodeId, result.updatedContext)
    this.executionState.set(nodeId, 'completed')

    // PUSH: Propagate outputs to successors
    await this.propagateOutputs(nodeId, result, flowDef)

    return result
  }

  /**
   * PULL: Ensure all dependencies are executed before this node
   * This is the key to handling chains of nodes leading to an input
   */
  private async ensureDependenciesReady(nodeId: string, flowDef: FlowDefinition): Promise<void> {
    const incomingEdges = this.incomingEdges.get(nodeId) || []

    // Execute all source nodes (recursively ensures their dependencies are ready)
    for (const edge of incomingEdges) {
      await this.executeNode(edge.source, flowDef)
    }
  }

  /**
   * Collect inputs from all incoming edges
   */
  private collectInputs(nodeId: string): Record<string, any> {
    const inputs: Record<string, any> = {}
    const incomingEdges = this.incomingEdges.get(nodeId) || []

    for (const edge of incomingEdges) {
      const sourceOutputs = this.nodeOutputs.get(edge.source)
      if (sourceOutputs && edge.sourceOutput in sourceOutputs) {
        inputs[edge.targetInput] = sourceOutputs[edge.sourceOutput]
      }
    }

    return inputs
  }

  /**
   * PUSH: Propagate outputs to successors
   * This triggers execution of nodes that are now ready
   */
  private async propagateOutputs(nodeId: string, result: NodeOutput, flowDef: FlowDefinition): Promise<void> {
    const outgoingEdges = this.outgoingEdges.get(nodeId) || []

    // For each successor, check if it's now ready to execute
    const successorIds = new Set(outgoingEdges.map(e => e.target))

    for (const successorId of successorIds) {
      // Check if all required inputs are now available
      if (this.isNodeReady(successorId)) {
        // Execute successor (will pull any remaining dependencies)
        await this.executeNode(successorId, flowDef)
      }
    }
  }

  /**
   * Check if a node has all required inputs available
   */
  private isNodeReady(nodeId: string): boolean {
    // If already executing or completed, not ready to execute again
    const state = this.executionState.get(nodeId)
    if (state === 'executing' || state === 'completed') {
      return false
    }

    // Check if all required inputs are available
    const requiredInputs = this.requiredInputs.get(nodeId) || new Set()
    const incomingEdges = this.incomingEdges.get(nodeId) || []

    // For each required input, check if there's a completed source node providing it
    for (const inputName of requiredInputs) {
      const providingEdge = incomingEdges.find(e => e.targetInput === inputName)
      if (!providingEdge) continue // Optional input

      const sourceState = this.executionState.get(providingEdge.source)
      if (sourceState !== 'completed') {
        return false // Required input not yet available
      }
    }

    return true
  }

  /**
   * Build graph structure for efficient lookups
   */
  private buildGraphStructure(flowDef: FlowDefinition): void {
    // Build edge maps
    for (const edge of flowDef.edges) {
      if (!this.incomingEdges.has(edge.target)) {
        this.incomingEdges.set(edge.target, [])
      }
      this.incomingEdges.get(edge.target)!.push(edge)

      if (!this.outgoingEdges.has(edge.source)) {
        this.outgoingEdges.set(edge.source, [])
      }
      this.outgoingEdges.get(edge.source)!.push(edge)
    }

    // Determine required inputs for each node
    for (const node of flowDef.nodes) {
      const requiredInputs = this.getRequiredInputsForNode(node)
      this.requiredInputs.set(node.id, requiredInputs)
    }
  }
}
```

### How This Solves the Chain Problem

**Example: Chain leading to an input**
```
toolsNode → processNode → formatNode → chatNode
                                          ↑
                                     userInput
```

When `chatNode` needs to execute:
1. `executeNode('chatNode')` is called
2. `ensureDependenciesReady('chatNode')` pulls all dependencies:
   - Calls `executeNode('formatNode')`
   - Which calls `executeNode('processNode')`
   - Which calls `executeNode('toolsNode')`
   - `toolsNode` has no dependencies, executes immediately
   - Returns to `processNode`, which now executes
   - Returns to `formatNode`, which now executes
   - Returns to `chatNode`
3. `chatNode` collects inputs from `formatNode` and `userInput`
4. `chatNode` executes
5. `chatNode` pushes outputs to successors

**Key Insight**: The PULL phase (ensureDependenciesReady) recursively executes the entire chain before the node runs. The PUSH phase (propagateOutputs) triggers successors that are now ready.

### Execution Trace Example

**Flow:**
```
        toolsNode
            ↓
        processNode
            ↓
        formatNode ──→ chatNode ←── userInput
                          ↓
                      responseNode
```

**Execution sequence when flow starts:**

1. **Entry nodes found**: `toolsNode`, `userInput`
2. **Execute `toolsNode`**:
   - No dependencies → executes immediately
   - Outputs: `{tools: [...]}`
   - Push to successors: `processNode` not ready (waiting for other inputs? No, it's ready!)
   - Execute `processNode`
3. **Execute `processNode`** (triggered by push from `toolsNode`):
   - Pull dependencies: `toolsNode` (already completed ✓)
   - Collect inputs: `{tools: [...]}`
   - Execute
   - Outputs: `{processedTools: [...]}`
   - Push to successors: `formatNode` ready!
   - Execute `formatNode`
4. **Execute `formatNode`** (triggered by push from `processNode`):
   - Pull dependencies: `processNode` (already completed ✓)
   - Collect inputs: `{processedTools: [...]}`
   - Execute
   - Outputs: `{formattedData: "..."}`
   - Push to successors: `chatNode` not ready (still waiting for `userInput`)
5. **Execute `userInput`**:
   - No dependencies → executes immediately
   - Status: `paused` → waits for user input
   - (User provides input: "Hello")
   - Resume: Outputs: `{message: "Hello"}`
   - Push to successors: `chatNode` now ready! (has both `formattedData` and `message`)
   - Execute `chatNode`
6. **Execute `chatNode`** (triggered by push from `userInput`):
   - Pull dependencies: `formatNode` (completed ✓), `userInput` (completed ✓)
   - Collect inputs: `{tools: [...], message: "Hello"}`
   - Execute with tools
   - Outputs: `{response: "..."}`
   - Push to successors: `responseNode` ready!
   - Execute `responseNode`
7. **Execute `responseNode`** (triggered by push from `chatNode`):
   - Pull dependencies: `chatNode` (completed ✓)
   - Collect inputs: `{response: "..."}`
   - Execute
   - Done!

**Key observations:**
- The chain `toolsNode → processNode → formatNode` executes automatically via push propagation
- `chatNode` waits until BOTH inputs are ready (join behavior)
- No manual tracking of "how many predecessors completed" - the `isNodeReady()` check handles it
- Each node only executes once (memoization)

### Benefits

✅ **Handles chains automatically**: Pull phase recursively executes dependencies
✅ **Handles branching**: Push phase triggers multiple successors
✅ **Handles joins**: Node only executes when all inputs ready
✅ **Prevents duplicate execution**: Memoization via executionState
✅ **Detects cycles**: Throws error if node is already executing
✅ **Simple to understand**: Pull dependencies → Execute → Push to successors
✅ **No manual counting**: Don't need to track "N of M predecessors completed"

---

## 5. Migration Strategy

1. **Create new types** in `electron/ipc/flows-v2.ts`
2. **Implement node functions** for each node type
3. **Implement scheduler** with clear logging
4. **Test with simple flows** (single context, linear flow)
5. **Test with complex flows** (multiple contexts, branching, tools)
6. **Migrate UI** to use new edge format
7. **Remove old code** once new engine is proven

---

## Benefits

✅ **Explicit**: Can see exactly what data flows where  
✅ **Debuggable**: Easy to log inputs/outputs at each node  
✅ **Testable**: Nodes are pure functions  
✅ **Type-safe**: Named inputs/outputs can be typed  
✅ **Maintainable**: Clear separation of concerns  
✅ **Extensible**: Easy to add new node types  
✅ **Understandable**: No magic, no implicit behavior

