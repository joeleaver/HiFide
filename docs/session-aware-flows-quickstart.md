# Session-Aware Flows - Quick Start Guide

## What Problem Does This Solve?

Previously, the Flow Editor had no concept of a "session" or conversation context. Every node executed independently, and there was no way to:
- Run setup operations before starting a conversation
- Build the initial message from multiple sources
- Execute operations in parallel while maintaining conversation context
- Run cleanup operations after the conversation completes

**Session-aware flows solve this** by introducing execution contexts that control when and how nodes run in relation to the conversation lifecycle.

## Quick Example: RAG Flow with External Search

Let's build a Retrieval-Augmented Generation (RAG) flow that searches multiple sources in parallel:

### Step 1: Create the Flow

1. Open Flow Editor
2. Drag nodes from the palette:
   - **User Message** node (for user input)
   - **Vector Search** node (for semantic search)
   - **Web Search** node (for current information)
   - **Chat (LLM)** node (for generating response)
   - **Stream Response** node (for output)

### Step 2: Configure Session Contexts

Click each node to expand its properties and set the session context:

**User Message Node:**
- Session Context: **Session Init** (🎬 INIT)
- This becomes the first message in the conversation

**Vector Search Node:**
- Session Context: **Out-of-Session** (🔍 OBS)
- This runs in parallel, results merged as observations

**Web Search Node:**
- Session Context: **Out-of-Session** (🔍 OBS)
- This also runs in parallel

**Chat (LLM) Node:**
- Session Context: **In-Session** (default, no badge)
- This runs in the conversation with all context

**Stream Response Node:**
- Session Context: **In-Session** (default)
- This outputs the final response

### Step 3: Connect the Nodes

```
[User Message] (session-init)
       ↓
[Vector Search] (out-of-session) ──┐
                                    ├─→ [Chat] (in-session)
[Web Search] (out-of-session) ─────┘        ↓
                                    [Stream Response] (in-session)
```

### Step 4: Run the Flow

When you run this flow:

1. **Phase 1: Session Init**
   - User Message executes
   - Output becomes: `{ role: 'user', content: 'What is the weather in Paris?' }`

2. **Phase 2: Session Loop**
   - Vector Search and Web Search run **in parallel**
   - Results are collected as observations:
     ```
     { role: 'system', content: '[Observation from vectorSearch]: Historical weather data...' }
     { role: 'system', content: '[Observation from webSearch]: Current forecast...' }
     ```

3. **Phase 3: In-Session Processing**
   - Chat node receives ALL messages:
     ```javascript
     [
       { role: 'user', content: 'What is the weather in Paris?' },
       { role: 'system', content: '[Observation from vectorSearch]: ...' },
       { role: 'system', content: '[Observation from webSearch]: ...' }
     ]
     ```
   - LLM generates response with full context
   - Response is added to session: `{ role: 'assistant', content: '...' }`

4. **Phase 4: Output**
   - Stream Response outputs the final answer

## Common Patterns

### Pattern 1: Data Validation Pipeline

```
[Load Data] (pre-session)
     ↓
[Validate Schema] (pre-session)
     ↓
[Create Prompt] (session-init)
     ↓
[Chat] (in-session)
     ↓
[Save Results] (post-session)
     ↓
[Send Notification] (post-session)
```

**Use Case:** Load and validate data before starting the conversation, then save results and notify after completion.

### Pattern 2: Multi-Agent Collaboration

```
[User Question] (session-init)
     ↓
[Main Agent] (in-session) ──┐
                            │
[Code Expert] (out-of-session) ──┐
                                 ├─→ [Synthesizer] (in-session)
[Design Expert] (out-of-session) ┘        ↓
                                   [Stream Response] (in-session)
```

**Use Case:** Main agent processes the question while expert agents provide specialized insights in parallel.

### Pattern 3: Iterative Refinement

```
[Initial Prompt] (session-init)
     ↓
[Draft Response] (in-session)
     ↓
[Quality Check] (out-of-session)
     ↓
[Refine Response] (in-session)
     ↓
[Final Output] (in-session)
```

**Use Case:** Generate a draft, check quality externally, then refine based on feedback.

## Visual Indicators

### Session Context Badges

Each node displays a colored badge showing its session context:

- **⚙️ PRE** (Purple) - Pre-Session
- **🎬 INIT** (Violet) - Session Init
- **🔍 OBS** (Cyan) - Out-of-Session
- **🏁 POST** (Lime) - Post-Session
- **No badge** - In-Session (default)

### Execution Log

The debug panel shows phase transitions:

```
[Phase 1: Pre-Session]
[loadData] Loading data from database...
[validateData] Schema validation passed

[Phase 2: Session Initialization]
[userMessage] [session-init] → user message: What is...

[Phase 3: Session Loop]
[vectorSearch] [out-of-session] → observation: Found 5 relevant documents...
[webSearch] [out-of-session] → observation: Current information...
[chat] [in-session] Using 3 session messages
[chat] Generating response...

[Phase 4: Post-Session]
[saveResults] Results saved to database
[sendNotification] Notification sent
```

## Best Practices

### 1. Use Pre-Session for Setup
```
✅ DO: [Load Config] (pre-session) → [Validate] (pre-session)
❌ DON'T: [Load Config] (in-session) - wastes conversation tokens
```

### 2. Keep Session-Init Simple
```
✅ DO: [User Message] (session-init) - just the initial message
❌ DON'T: [Complex Processing] (session-init) - do this pre-session
```

### 3. Use Out-of-Session for I/O
```
✅ DO: [API Call] (out-of-session) - runs in parallel
❌ DON'T: [API Call] (in-session) - blocks conversation
```

### 4. Reserve Post-Session for Cleanup
```
✅ DO: [Log Results] (post-session) - after conversation
❌ DON'T: [Generate Response] (post-session) - too late!
```

### 5. Default to In-Session
```
✅ DO: Most nodes should be in-session unless there's a reason
❌ DON'T: Over-complicate with unnecessary context changes
```

## Debugging Tips

### Check Phase Execution
Look for phase markers in the execution log:
- `[Phase 1: Pre-Session]`
- `[Phase 2: Session Initialization]`
- `[Phase 3: Session Loop]`
- `[Phase 4: Post-Session]`

### Verify Message Flow
In-session chat nodes log message count:
- `[chat] [in-session] Using 3 session messages`

Out-of-session nodes show observation format:
- `[vectorSearch] [out-of-session] → observation: ...`

### Use Breakpoints
Set breakpoints on nodes to pause execution and inspect:
- Session message accumulation
- Out-of-session results
- Node outputs at each phase

## Migration from Old Flows

Existing flows continue to work! All nodes default to `in-session` behavior.

To adopt session-aware execution:

1. **Identify setup nodes** - Set to `pre-session`
2. **Identify initial message nodes** - Set to `session-init`
3. **Identify parallel operations** - Set to `out-of-session`
4. **Identify cleanup nodes** - Set to `post-session`
5. **Leave conversation nodes** - Keep as `in-session` (default)

## Next Steps

- Read the full [Session-Aware Flows Architecture](./session-aware-flows.md) documentation
- Experiment with different session contexts
- Build complex multi-phase workflows
- Share your patterns with the team!

---

**Status**: ✅ Fully implemented and ready to use!

