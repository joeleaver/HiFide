# Core Provider Implementation Review

## Critical Issues Found

### 1. **MAJOR: Anthropic System Message Format Mismatch** ⚠️
**Location:** `openai-compatible.ts` line 332-334

The provider receives `system` as a **string** from `llm-service.ts` (line 510), but Anthropic's OpenAI-compatible API expects `system` to be an **array of blocks** (see `llm-service.ts` line 490-491).

```typescript
// Current (WRONG for Anthropic):
if (system && typeof system === 'string') {
  conversationMessages.unshift({ role: 'system', content: system })
}

// Should be:
if (system) {
  if (Array.isArray(system)) {
    // Anthropic format - blocks
    conversationMessages.unshift({ role: 'system', content: system })
  } else if (typeof system === 'string') {
    // OpenAI format - string
    conversationMessages.unshift({ role: 'system', content: system })
  }
}
```

**Impact:** Anthropic requests likely fail or behave unexpectedly.

---

### 2. **MAJOR: Gemini Message Format Not Handled** ⚠️
**Location:** `openai-compatible.ts` line 329

The provider converts messages to OpenAI format, but Gemini uses a completely different format (`contents` with `parts`). The `llm-service.ts` passes `contents` for Gemini (line 208), but the provider ignores it.

**Current flow:**
- llm-service passes `contents` for Gemini
- Provider converts `messages` to OpenAI format
- Gemini receives wrong format

**Fix needed:** Check provider ID and handle Gemini's native format.

---

### 3. **CRITICAL: Async Loop Not Awaited** ⚠️
**Location:** `openai-compatible.ts` line 690

```typescript
runLoop().catch((err: any) => { ... })  // Fire-and-forget!

return {
  cancel: () => { ... }
}
```

The async loop runs in the background without awaiting. This means:
- Function returns immediately
- Caller doesn't know when streaming completes
- Errors may not propagate correctly
- Race conditions possible

**Should be:**
```typescript
const loopPromise = runLoop().catch(...)
return { cancel: () => { ... }, loopPromise }
```

Or better: Make the entire function properly async.

---

### 4. **MAJOR: Reasoning State Not Reset Between Steps** ⚠️
**Location:** `openai-compatible.ts` line 337-341, 457-461

The `reasoningState` is initialized once but never reset between agentic loop iterations. This causes:
- Reasoning from previous steps bleeds into next steps
- State machine gets corrupted
- Incorrect reasoning extraction

**Fix:** Reset state at start of each loop iteration.

---

### 5. **BUG: Tool Call Deduplication Logic Flawed** ⚠️
**Location:** `openai-compatible.ts` line 493

```typescript
const isNewToolCall = tc.id && existing && existing.id && tc.id !== existing.id
```

This only detects new tool calls if BOTH have IDs. But:
- First chunk might not have ID yet
- Comparison happens before ID is assigned
- Gemini sends complete tool calls, OpenAI streams them

**Better approach:** Use a Set of seen IDs, not index-based detection.

---

### 6. **DESIGN: Stateful Provider in Stateless Architecture** ⚠️
**Location:** `openai-compatible.ts` throughout

The provider maintains state across the agentic loop:
- `conversationMessages` (mutated)
- `reasoningState` (mutated)
- `cancelled` flag
- `turnText`, `turnReasoning`

This violates the stated design: "Providers are stateless" (provider.ts comment). This makes:
- Testing harder
- Reuse problematic
- Concurrency unsafe

---

### 7. **BUG: Missing `responseSchema` Parameter** ⚠️
**Location:** `openai-compatible.ts` line 357-364

The `responseSchema` is passed to `agentStream` but never used in the request body. It's silently ignored.

**Fix:** Add to request body for providers that support structured outputs.

---

### 8. **ISSUE: Gemini Tool Result Workaround Fragile** ⚠️
**Location:** `openai-compatible.ts` line 633-640

```typescript
const isGemini = id === 'gemini-openai' || id.startsWith('gemini')
```

This string matching is fragile. If provider ID changes, breaks silently.

**Better:** Use provider capabilities registry or explicit config.

---

## Best Practice Issues

1. **No input validation** - Parameters not validated before use
2. **Inconsistent error handling** - Some errors logged, some swallowed
3. **Magic strings** - Provider IDs hardcoded throughout
4. **No rate limit backoff jitter** - Exponential backoff exists but could be better
5. **Debug logging too verbose** - Full message dumps on every chunk

---

## Recommendations

1. **Separate provider implementations** - Don't try to handle all formats in one factory
2. **Add provider capability registry** - Use config instead of string matching
3. **Make async properly** - Await the loop, don't fire-and-forget
4. **Reset state between steps** - Clear reasoning state each iteration
5. **Add input validation** - Validate all parameters at entry
6. **Use TypeScript more strictly** - Avoid `any` types

