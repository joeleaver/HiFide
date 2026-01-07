# Detailed Provider Analysis - Weird Behavior Root Causes

## Why You're Seeing Weird Agent Behavior

### Root Cause #1: Anthropic System Messages Silently Fail
When using Anthropic, the system message is being added as a regular message instead of a block:

```typescript
// What provider sends (WRONG):
{ role: 'system', content: 'Your instructions...' }

// What Anthropic expects:
{ role: 'system', content: [{ type: 'text', text: 'Your instructions...' }] }
```

**Symptom:** Anthropic agents ignore system instructions or behave unpredictably.

---

### Root Cause #2: Async Loop Fire-and-Forget
The provider returns immediately while streaming happens in background:

```typescript
// Line 690-709
runLoop().catch(...)  // Starts but doesn't wait
return { cancel: () => { ... } }  // Returns immediately
```

**Symptom:** 
- Caller thinks request is done when it's still streaming
- onDone() called after function returns
- Race conditions with cancellation
- Errors may not propagate to caller

---

### Root Cause #3: Reasoning State Corruption
Reasoning extraction state persists across loop iterations:

```typescript
// Line 337-341: Initialized once
let reasoningState: ReasoningState = {
  buffer: '',
  insideTag: false,
  tagName: 'think'
}

// Line 457-461: Updated in loop but NEVER reset
const result = reasoningExtractor(delta.content, reasoningState)
reasoningState = result.state  // Accumulates forever
```

**Symptom:** 
- Reasoning from step 1 appears in step 2
- State machine gets stuck in "insideTag: true"
- Reasoning extraction fails after first tool call

---

### Root Cause #4: Tool Call Index Collision
Gemini sends parallel tool calls with index=0, OpenAI uses incrementing indices:

```typescript
// Line 492-513: Flawed detection
const existing = toolCalls.get(idx)
const isNewToolCall = tc.id && existing && existing.id && tc.id !== existing.id

// Problem: If first chunk lacks ID, detection fails
// Gemini: [{ index: 0, id: 'call_1', ... }, { index: 0, id: 'call_2', ... }]
// OpenAI: [{ index: 0, id: 'call_1', ... }, { index: 1, id: 'call_1', ... }]
```

**Symptom:**
- Parallel tool calls get merged
- Tool arguments corrupted
- Only first tool call executes

---

### Root Cause #5: Missing responseSchema
Structured output schema is accepted but ignored:

```typescript
// Line 542-551: Schema passed but never used
const agentStreamConfig = {
  ...streamOpts,
  tools: policyTools,
  responseSchema,  // ← Accepted
  // ...
}

// Line 357-364: Never added to request
let requestBody: any = {
  model,
  messages: conversationMessages,
  tools: hasTools ? openaiTools : undefined,
  // responseSchema missing!
}
```

**Symptom:** Structured output requests silently become unstructured.

---

## Weird Behavior Checklist

- [ ] Anthropic agents ignoring instructions? → Issue #1
- [ ] Agents stopping mid-task? → Issue #2 (async not awaited)
- [ ] Reasoning appearing in wrong places? → Issue #3
- [ ] Multiple tool calls getting merged? → Issue #4
- [ ] Structured outputs not working? → Issue #5

---

## Quick Fixes (Temporary)

1. **For Anthropic:** Check if system is array before unshifting
2. **For async:** Add `await runLoop()` before return
3. **For reasoning:** Reset state at loop start
4. **For tool calls:** Use Set-based deduplication
5. **For schema:** Add to request body if present

