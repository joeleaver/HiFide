# Context-Based Flow Execution

## Overview

The flow editor now supports **multiple concurrent execution contexts**, allowing different branches of a flow to run with different AI models and providers simultaneously. Context is automatically determined by graph topology rather than manual configuration.

## Key Concepts

### Execution Context

An **execution context** defines:
- **Provider**: Which AI provider to use (OpenAI, Anthropic, Gemini)
- **Model**: Which specific model to use
- **Message History**: Independent conversation history for this context

### Context Propagation

Context flows **vertically** through the graph via **top handles**:
- Each node has a **context input** (top handle, purple)
- Nodes inherit their execution context by tracing upward through context connections
- If no context connection exists, the node uses the **main context** (default provider/model)

### Data Flow

Data flows **vertically** (main flow) and **horizontally** (optional inputs):
- **Top handles** (purple): Context input - determines execution context
- **Bottom handles** (green): Data output - main output to downstream nodes
- **Left handles** (blue): Data inputs - optional inputs from other nodes
- Data can flow between nodes in different contexts

## Handle Types

### Top Handle (Context Input) - Purple
- **Position**: Top of the node
- **Purpose**: Determines which execution context this node runs in
- **Connection**: Connects to the bottom output of an upstream node
- **Behavior**: Node traces upward to find the nearest `newContext` node or uses main context
- **Special**: Entry nodes (`defaultContextStart`, `userMessage`) don't have this handle

### Left Handle(s) (Data Input) - Blue
- **Position**: Left side of the node
- **Purpose**: Receives optional data inputs from other nodes
- **Connection**: Connects to the bottom output of any upstream node
- **Behavior**: Uses the last value received (for complex merge logic, use dedicated merge nodes)
- **Variants**: Single handle (most nodes) or multiple handles (`parallelJoin` nodes)

### Bottom Handle (Data Output) - Green
- **Position**: Bottom of the node
- **Purpose**: Sends data to downstream nodes (main output)
- **Connection**: Connects to top (context) or left (data) handles of downstream nodes
- **Behavior**: Passes node's output to connected nodes
- **Variants**: Single handle (most nodes) or multiple handles (`conditional`, `parallelSplit` nodes)

## Node Types

### defaultContextStart Node

**The recommended entry point for all flows.** Configures the main/default execution context.

**Configuration:**
- **Provider**: Select AI provider for the main context (OpenAI, Anthropic, Gemini)
- **Model**: Select specific model for the main context
- **System Instructions**: Optional system prompt/instructions (cross-provider equivalent of system message)

**Behavior:**
- Defines the main execution context for the entire flow
- No context input (it's the root of the context tree)
- Has data input for user message
- Passes data through unchanged
- System instructions are prepended to the first message in the context

**Example Use Case:**
```
[Default Context Start] ← Configure GPT-4 + "You are a helpful coding assistant"
    ↓ (context)
[Chat Node] ← Uses GPT-4 with system instructions
```

### newContext Node

Creates a new execution context with custom provider/model settings.

**Configuration:**
- **Provider**: Select AI provider (OpenAI, Anthropic, Gemini)
- **Model**: Select specific model for this provider

**Behavior:**
- Defines a new execution context
- All downstream nodes (connected via top handle) inherit this context
- Passes data through unchanged

**Example Use Case:**
```
Main Context (GPT-4)
    ↓ (context)
[User Input]
    ↓ (context)
[New Context: Claude Sonnet]
    ↓ (context)
[Chat Node] ← Uses Claude Sonnet
```

### Other Nodes

All other nodes (chat, redactor, etc.) now:
- Have a **top context input** (except `userMessage` which is the entry point)
- Automatically execute in the context determined by their context chain
- Can receive data from nodes in different contexts via left handles

## Flow Patterns

### Single Context Flow
```
[Default Context Start: GPT-4]
    ↓ (context)
[Chat Node] ← Uses GPT-4 from main context
    ↓ (context)
[Stream Response]
```

### Multi-Context Flow
```
[Default Context Start: GPT-4]
             ↓ (context)
          [Chat A] ← Uses GPT-4
             ↓ (context)
    [New Context: Claude]
             ↓ (context)
          [Chat B] ← Uses Claude
```

### Parallel Contexts with Data Merge
```
[Default Context Start: GPT-4]
             ↓ (context)
    ┌────────┴────────┐
    ↓ (context)       ↓ (context)
[New Context: GPT-4]  [New Context: Claude]
    ↓ (context)       ↓ (context)
 [Chat A]          [Chat B]
    ↓ (data)          ↓ (data)
    └────────┬────────┘
             ↓ (data inputs)
        [Merge Node] ← Uses main context, receives data from both
```

## Context Detection Algorithm

The execution engine builds a context map before execution:

1. **Initialize**: Create main context with default provider/model
2. **Scan nodes**: For each node in the graph:
   - If node is `newContext`: Register it as a new context with its provider/model
   - Otherwise: Trace upward through context edges to find parent context
3. **Build map**: Create `nodeId -> contextId` mapping
4. **Execute**: Each node uses its mapped context for execution

## Message History Management

Each context maintains its own independent message history:

```typescript
contextMessages = Map<contextId, Message[]>

// When a chat node executes:
const contextId = nodeToContext.get(nodeId)
const messages = contextMessages.get(contextId)
const response = await llm.chat([...messages, userInput])
messages.push({ role: 'assistant', content: response })
```

## Migration from Phase-Based Execution

### Old System (Deprecated)
- Manual `sessionContext` dropdown (pre-session, session-init, in-session, etc.)
- Phase-based execution order
- Single global message history
- Single provider/model for entire flow

### New System
- Automatic context detection via graph topology
- Graph-based execution order
- Multiple independent message histories
- Multiple providers/models per flow

### Breaking Changes
- `sessionContext` config property is now ignored
- Phase-based execution removed
- All nodes now require proper context connections

## Best Practices

1. **Start with Default Context Start**: Always begin flows with a `defaultContextStart` node to configure the main context
2. **Configure System Instructions**: Use the system instructions field to set the AI's behavior/role
3. **Context Chains**: Connect nodes vertically via top handles to establish context
4. **Data Flow**: Use left/right handles for data passing between contexts
5. **Context Boundaries**: Use `newContext` nodes to switch providers/models mid-flow
6. **Testing**: Test each context branch independently before merging

## Examples

### Example 1: Cheap Classification, Expensive Generation
```
[Default Context Start: GPT-4o-mini]
    ↓ (context)
[Chat: Classify Intent] ← Uses GPT-4o-mini (cheap)
    ↓ (context)
[New Context: GPT-4] ← Switch to expensive model
    ↓ (context)
[Chat: Generate Response] ← Uses GPT-4 (expensive)
```

### Example 2: Multi-Model Consensus
```
[Default Context Start: GPT-4]
             ↓ (context)
    ┌────────┼────────┐
    ↓        ↓        ↓ (context to all)
[New Context: GPT-4]  [New Context: Claude]  [New Context: Gemini]
    ↓        ↓        ↓ (context)
[Chat A]  [Chat B]  [Chat C]
    ↓        ↓        ↓ (data from all)
    └────────┼────────┘
             ↓ (data inputs)
    [Consensus Merger] ← Uses main GPT-4 context
```

### Example 3: Specialized Contexts with System Instructions
```
[Default Context Start: Claude]
  System: "You are a code analysis expert"
    ↓ (context)
[Analyze Code] ← Uses Claude with analysis instructions
    ↓ (data)
    ↓ (context from main)
[New Context: GPT-4]
  (inherits from main, no system instructions)
    ↓ (context)
[Generate Fix] ← Uses GPT-4
```

## Troubleshooting

### Node not using expected context
- Check context chain: Trace upward through top handles
- Verify `newContext` node configuration
- Check for disconnected context edges

### Data not flowing correctly
- Verify left/right handle connections
- Check join strategy for multi-input nodes
- Ensure data edges (not context edges) are used

### Context map errors
- Check for cycles in context chain
- Verify all `newContext` nodes have valid provider/model
- Check console for context map debug output

