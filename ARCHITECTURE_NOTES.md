# Architecture & Best Practices Notes

## Design Tension: "Stateless Providers" vs Reality

**Stated Design** (provider.ts):
> "Providers are stateless and accept messages in their native format"

**Actual Implementation** (openai-compatible.ts):
- Maintains `conversationMessages` (mutated throughout loop)
- Maintains `reasoningState` (mutated across iterations)
- Maintains `cancelled` flag
- Maintains `turnText`, `turnReasoning` accumulators

**Problem:** This violates the stated contract and makes the code harder to reason about.

**Solution:** Either:
1. Make providers truly stateless (pass state in/out)
2. Update documentation to reflect stateful design
3. Use a separate "agent runner" class for state management

---

## Provider Format Mismatch Problem

The factory tries to handle 6 different provider formats:

| Provider | System | Messages | Contents |
|----------|--------|----------|----------|
| OpenAI | string | array | - |
| Anthropic | blocks[] | array | - |
| Gemini | string | - | array |
| Fireworks | string | array | - |
| xAI | string | array | - |
| OpenRouter | string | array | - |

**Current approach:** Convert everything to OpenAI format, then handle Gemini specially.

**Better approach:** Separate implementations per provider family:
- `openai-compatible.ts` (OpenAI, Fireworks, xAI, OpenRouter)
- `anthropic-native.ts` (Anthropic)
- `gemini-native.ts` (Gemini)

---

## Async/Await Pattern Issue

**Current:**
```typescript
runLoop().catch(...)  // Fire-and-forget
return { cancel: () => {} }
```

**Problem:** Caller has no way to know when streaming completes.

**Better:**
```typescript
const loopPromise = runLoop()
return {
  cancel: () => { ... },
  // For callers that need to await
  _loopPromise: loopPromise
}
```

Or make the entire function properly async and await internally.

---

## State Machine Corruption

The reasoning extraction uses a state machine:
```
buffer: string
insideTag: boolean
tagName: string
```

**Problem:** State persists across loop iterations, causing:
- `insideTag: true` from step 1 affects step 2
- Partial tags from step 1 corrupt step 2 parsing

**Fix:** Reset state at loop start:
```typescript
reasoningState = { buffer: '', insideTag: false, tagName: 'think' }
```

---

## Tool Call Handling Complexity

Current approach tries to handle both:
- **OpenAI style:** Streaming deltas with same ID, incrementing indices
- **Gemini style:** Complete calls with unique IDs, all index=0

**Problem:** Index-based detection fails when IDs arrive in different order.

**Better:** Use ID-based Set tracking:
```typescript
const seenIds = new Set<string>()
// Track by ID, not index
```

---

## Missing Validations

No validation of:
- `apiKey` (could be empty string)
- `model` (could be undefined)
- `messages` (could be malformed)
- `tools` (could have invalid schemas)
- `system` (could be wrong type)

**Recommendation:** Add input validation at function entry:
```typescript
if (!apiKey?.trim()) throw new Error('Missing API key')
if (!model) throw new Error('Missing model')
if (!Array.isArray(messages)) throw new Error('Invalid messages')
```

---

## Provider Detection Anti-Pattern

```typescript
const isGemini = id === 'gemini-openai' || id.startsWith('gemini')
```

**Problem:** Fragile string matching, breaks if ID changes.

**Better:** Use provider capabilities registry:
```typescript
const capabilities = providerCapabilities[id]
if (capabilities.requiresToolResultWorkaround) { ... }
```

---

## Recommendations Summary

1. **Separate implementations** - Don't try to handle all formats in one factory
2. **Make async explicit** - Await loops, don't fire-and-forget
3. **Reset state properly** - Clear reasoning state each iteration
4. **Use ID-based tracking** - Not index-based for tool calls
5. **Add validation** - Check inputs at entry point
6. **Use capabilities registry** - Not string matching
7. **Document state** - If stateful, document clearly

