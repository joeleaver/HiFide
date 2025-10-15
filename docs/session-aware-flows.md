# Session-Aware Flow Architecture

## Overview

The Flow Editor now supports **session-aware execution**, allowing nodes to run at different points in the conversation lifecycle. This enables sophisticated workflows where some operations happen before the session starts, some become part of the conversation, and others run in parallel as observations.

## Session Execution Contexts

Each node can be configured with a `sessionContext` property that determines when and how it executes:

### 1. **Pre-Session** (`pre-session`)
- **When**: Runs before any session/conversation starts
- **Use Cases**: 
  - Data preparation and validation
  - Loading context from external sources
  - Setting up environment variables
  - Pre-flight checks
- **Output**: Passed to downstream nodes, not added to conversation
- **Badge**: ⚙️ PRE (purple)

### 2. **Session Init** (`session-init`)
- **When**: Runs at session initialization
- **Use Cases**:
  - Creating the initial user message
  - Setting up conversation context
  - Injecting system prompts
- **Output**: Becomes the first user message in the session
- **Badge**: 🎬 INIT (violet)

### 3. **In-Session** (`in-session`) - DEFAULT
- **When**: Runs within the conversation loop
- **Use Cases**:
  - Main LLM chat nodes
  - Conversation flow control
  - Response processing
- **Output**: Part of the conversation history
- **Badge**: None (default behavior)

### 4. **Out-of-Session** (`out-of-session`)
- **When**: Runs in parallel to the session
- **Use Cases**:
  - External API calls
  - Database queries
  - File system operations
  - Background processing
- **Output**: Merged back as system message observations
- **Badge**: 🔍 OBS (cyan)

### 5. **Post-Session** (`post-session`)
- **When**: Runs after session completes
- **Use Cases**:
  - Cleanup operations
  - Logging and analytics
  - Result processing
  - Notifications
- **Output**: Passed to downstream nodes, not added to conversation
- **Badge**: 🏁 POST (lime)

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. PRE-SESSION PHASE                                    │
│    - All pre-session nodes execute                      │
│    - Can run in parallel or sequence based on graph     │
│    - Results available to downstream nodes              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. SESSION INITIALIZATION                               │
│    - Session-init nodes create initial messages         │
│    - Output becomes { role: 'user', content: output }   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. SESSION LOOP                                         │
│    ┌─────────────────────────────────────────────────┐ │
│    │ In-Session Nodes                                │ │
│    │ - Execute in conversation context               │ │
│    │ - Can see and modify conversation history       │ │
│    └─────────────────────────────────────────────────┘ │
│                                                          │
│    ┌─────────────────────────────────────────────────┐ │
│    │ Out-of-Session Nodes (Parallel)                 │ │
│    │ - Execute independently                         │ │
│    │ - Results merged as system observations        │ │
│    │ - Format: { role: 'system',                     │ │
│    │           content: '[observation] output' }     │ │
│    └─────────────────────────────────────────────────┘ │
│                                                          │
│    Loop continues until terminal condition              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. POST-SESSION PHASE                                   │
│    - All post-session nodes execute                     │
│    - Cleanup, logging, result processing                │
└─────────────────────────────────────────────────────────┘
```

## Example Workflows

### Example 1: RAG with External Search

```
[userMessage] (session-init)
    ↓
[vectorSearch] (out-of-session) ──┐
                                   ├─→ [chat] (in-session)
[webSearch] (out-of-session) ─────┘        ↓
                                    [streamResponse] (in-session)
```

- User message initializes the session
- Vector and web searches run in parallel outside the session
- Results are merged as observations into the chat context
- Chat node processes with all context
- Response is streamed back

### Example 2: Data Pipeline with Validation

```
[loadData] (pre-session)
    ↓
[validateData] (pre-session)
    ↓
[createPrompt] (session-init)
    ↓
[chat] (in-session)
    ↓
[saveResults] (post-session)
    ↓
[sendNotification] (post-session)
```

- Data is loaded and validated before session starts
- Validated data is used to create the initial prompt
- Chat processes the request
- Results are saved and notification sent after session completes

### Example 3: Multi-Agent Collaboration

```
[userMessage] (session-init)
    ↓
[mainAgent] (in-session) ──┐
                           │
[expertAgent1] (out-of-session) ──┐
                                  ├─→ [synthesize] (in-session)
[expertAgent2] (out-of-session) ──┘        ↓
                                    [streamResponse] (in-session)
```

- Main agent processes in the conversation
- Expert agents run in parallel as observations
- Synthesis node combines all perspectives
- Final response is streamed

## UI Indicators

### Node Badges
Each node displays a colored badge indicating its session context:
- **⚙️ PRE** - Purple badge for pre-session nodes
- **🎬 INIT** - Violet badge for session-init nodes
- **🔍 OBS** - Cyan badge for out-of-session nodes
- **🏁 POST** - Lime badge for post-session nodes
- **No badge** - In-session nodes (default)

### Configuration Panel
When a node is expanded, the session context can be changed via dropdown:
- Clear descriptions for each context
- Emoji indicators for quick recognition
- Helpful tooltips explaining use cases

## Implementation Status

### ✅ Completed
- Session context property added to node config
- UI selector in node properties panel
- Visual badges on nodes
- Documentation and examples
- **Flow execution engine with session-aware phases**
- **Session state management with message accumulation**
- **Message construction and merging for out-of-session nodes**
- **Execution order validation and phase-based scheduling**
- **In-session chat nodes use accumulated conversation history**
- **Out-of-session results merged as system observations**

### 📋 Future Enhancements
- Session lifecycle hooks for custom logic
- Session state persistence across flow runs
- Advanced debugging UI for session message flow
- Session branching and merging strategies

## Best Practices

1. **Use pre-session for expensive operations** - Load data, validate inputs, prepare context before starting the conversation

2. **Keep session-init simple** - Just create the initial message, don't do heavy processing

3. **Use out-of-session for I/O** - External API calls, database queries, file operations should run outside the session to avoid blocking

4. **Reserve post-session for cleanup** - Logging, analytics, notifications that don't affect the conversation

5. **Default to in-session** - Most nodes should be in-session unless there's a specific reason to use another context

## Migration Guide

Existing flows will continue to work - all nodes default to `in-session` behavior. To adopt session-aware execution:

1. Identify nodes that should run before/after the session
2. Set their `sessionContext` property accordingly
3. Adjust node connections to reflect the execution flow
4. Test the flow to ensure proper execution order

## Technical Details

### Node Configuration
```typescript
{
  id: 'node-1',
  type: 'hifiNode',
  data: {
    kind: 'chat',
    config: {
      sessionContext: 'in-session', // or pre-session, session-init, out-of-session, post-session
      // ... other config
    }
  }
}
```

### Execution Engine Implementation
The flow executor (`electron/ipc/flows.ts`) implements session-aware execution:

#### Phase-Based Execution
```typescript
// 1. Group nodes by session context
const nodesByContext = {
  'pre-session': nodes.filter(n => getSessionContext(n.id) === 'pre-session'),
  'session-init': nodes.filter(n => getSessionContext(n.id) === 'session-init'),
  'in-session': nodes.filter(n => getSessionContext(n.id) === 'in-session'),
  'out-of-session': nodes.filter(n => getSessionContext(n.id) === 'out-of-session'),
  'post-session': nodes.filter(n => getSessionContext(n.id) === 'post-session'),
}

// 2. Execute phases in order
await executeNodeGroup(nodesByContext['pre-session'])
await executeNodeGroup(nodesByContext['session-init'])
// ... session loop ...
await executeNodeGroup(nodesByContext['post-session'])
```

#### Session Message Management
```typescript
// Session messages accumulate throughout execution
const sessionMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

// Session-init outputs become user messages
for (const node of nodesByContext['session-init']) {
  const output = getNodeOutput(node.id)
  sessionMessages.push({ role: 'user', content: output })
}

// In-session chat nodes use accumulated messages
if (sessionContext === 'in-session') {
  const messagesToSend = [...sessionMessages, { role: 'user', content: currentInput }]
  const response = await llm.chat(messagesToSend)
  sessionMessages.push({ role: 'assistant', content: response })
}

// Out-of-session results merged as observations
for (const [nodeId, result] of outOfSessionResults) {
  sessionMessages.push({
    role: 'system',
    content: `[Observation from ${nodeId}]: ${result}`
  })
}
```

#### Graph Dependency Handling
Each phase respects graph dependencies within that phase:
- Nodes execute in parallel waves
- Multi-input joins wait for all predecessors
- Execution order determined by graph topology
- Cross-phase dependencies handled by phase ordering

---

**Status**: ✅ Fully implemented and ready to use!

