# Quick Reference Checklist

## 5 Critical Bugs - Quick Fix Checklist

### Bug #1: Anthropic System Message ✓
- **File:** `electron/providers-ai-sdk/core/openai-compatible.ts`
- **Line:** 332-334
- **Problem:** String added instead of blocks array
- **Fix:** Check `Array.isArray(system)` before processing
- **Test:** Anthropic agents should follow system instructions
- **Priority:** 🔴 CRITICAL

### Bug #2: Async Loop Not Awaited ✓
- **File:** `electron/providers-ai-sdk/core/openai-compatible.ts`
- **Line:** 690-709
- **Problem:** Fire-and-forget, returns before streaming completes
- **Fix:** Await `runLoop()` before returning
- **Test:** `onDone()` should be called before function returns
- **Priority:** 🔴 CRITICAL

### Bug #3: Reasoning State Not Reset ✓
- **File:** `electron/providers-ai-sdk/core/openai-compatible.ts`
- **Line:** 337-341, 353-354
- **Problem:** State persists across loop iterations
- **Fix:** Reset state at loop start: `reasoningState = { buffer: '', insideTag: false, tagName: 'think' }`
- **Test:** Reasoning from step 1 shouldn't appear in step 2
- **Priority:** 🔴 CRITICAL

### Bug #4: Tool Call Deduplication ✓
- **File:** `electron/providers-ai-sdk/core/openai-compatible.ts`
- **Line:** 482-514
- **Problem:** Index-based detection fails for parallel calls
- **Fix:** Use `Set<string>` to track seen IDs
- **Test:** Parallel tool calls should execute separately
- **Priority:** 🔴 CRITICAL

### Bug #5: ResponseSchema Ignored ✓
- **File:** `electron/providers-ai-sdk/core/openai-compatible.ts`
- **Line:** 357-364
- **Problem:** Parameter accepted but never used
- **Fix:** Add `...(responseSchema ? { response_format: ... } : {})` to request
- **Test:** Structured outputs should work
- **Priority:** 🔴 CRITICAL

---

## Secondary Issues - Should Fix

- [ ] Gemini format handling (line 329)
- [ ] Input validation (line 315+)
- [ ] Provider detection (line 633)
- [ ] Error handling consistency
- [ ] State machine documentation

---

## Testing Checklist

- [ ] Anthropic system message format
- [ ] Async loop completion
- [ ] Reasoning state reset
- [ ] Parallel tool calls
- [ ] ResponseSchema inclusion
- [ ] Multi-step agent loops
- [ ] Cancellation handling
- [ ] Error propagation

---

## Files to Review

1. **PROVIDER_FIXES.md** - Exact code changes
2. **PROVIDER_DETAILED_ANALYSIS.md** - Why each bug happens
3. **TESTING_RECOMMENDATIONS.md** - Test cases to add
4. **ARCHITECTURE_NOTES.md** - Design improvements

---

## Verification Steps

After applying fixes:

1. **Test Anthropic:**
   ```bash
   # Run with Anthropic provider
   # Verify system instructions are followed
   ```

2. **Test Async:**
   ```bash
   # Verify onDone() called before function returns
   # Check no race conditions
   ```

3. **Test Reasoning:**
   ```bash
   # Multi-step agent with reasoning
   # Verify reasoning doesn't bleed between steps
   ```

4. **Test Tools:**
   ```bash
   # Agent with multiple parallel tools
   # Verify all tools execute correctly
   ```

5. **Test Structured Output:**
   ```bash
   # Request with responseSchema
   # Verify schema is enforced
   ```

---

## Priority Order

1. **FIRST:** Bug #2 (async) - causes race conditions
2. **SECOND:** Bug #3 (reasoning) - causes data corruption
3. **THIRD:** Bug #1 (Anthropic) - breaks provider
4. **FOURTH:** Bug #4 (tools) - breaks multi-tool agents
5. **FIFTH:** Bug #5 (schema) - breaks structured outputs

---

## Estimated Effort

- **Bug #1:** 5 minutes
- **Bug #2:** 10 minutes
- **Bug #3:** 5 minutes
- **Bug #4:** 15 minutes
- **Bug #5:** 5 minutes
- **Testing:** 30 minutes

**Total:** ~70 minutes for all fixes + testing

---

## Questions?

- **"What's the exact fix?"** → See PROVIDER_FIXES.md
- **"Why does this happen?"** → See PROVIDER_DETAILED_ANALYSIS.md
- **"How do I test it?"** → See TESTING_RECOMMENDATIONS.md
- **"Is this a design issue?"** → See ARCHITECTURE_NOTES.md

