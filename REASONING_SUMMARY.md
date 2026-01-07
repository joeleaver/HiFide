# Reasoning Persistence: Executive Summary

## Your Question

> "I'm wondering if it makes any sense at all to include the reasoning with user prompts, spanning loops."

## Answer

**Yes, it makes sense - but only for reasoning-capable models, and your implementation is incomplete.**

---

## What's Happening Now

### ✅ Within Agent Loop (Correct)
- Reasoning is extracted from streaming chunks
- Re-injected in `<think>` tags for multi-step tool calls
- Works perfectly for maintaining context within a single LLM call

### ❌ Across Sessions (Incomplete)
- Reasoning IS stored in `messageHistory`
- Reasoning is ONLY re-injected for Fireworks and OpenRouter
- Missing: OpenAI (o1/o3), Anthropic (thinking), Gemini (thinking)

---

## The Problem

```
Stored for:     ALL providers
Re-injected for: Fireworks, OpenRouter only
Missing:        OpenAI o1/o3, Anthropic thinking, Gemini thinking
```

This means:
- Reasoning takes up space in session history
- But most providers never see it again
- Token waste for providers that don't re-inject
- Lost context for providers that should re-inject

---

## Why It Matters

### For Reasoning Models (o1, Claude thinking, Gemini thinking)
- **Should re-inject:** Yes
- **Why:** These models are designed to see their own reasoning
- **Benefit:** Better accuracy, maintains context, improves multi-turn performance

### For Regular Models (GPT-4o, Claude 3.5 Sonnet)
- **Should re-inject:** No
- **Why:** They don't use reasoning, just wastes tokens
- **Benefit:** Saves tokens, cleaner context

---

## Current Implementation

### Storage (llm-service.ts:342-353)
```typescript
// Reasoning stored for ALL providers
if (step.reasoning) {
  assistantMessage.reasoning = step.reasoning
  contextManager.addMessage(assistantMessage)
}
```

### Re-injection (payloads.ts:94)
```typescript
// Only re-injected for 2 providers
const OPENAI_REASONING_PROVIDERS = new Set(['fireworks', 'openrouter'])
```

---

## The Fix

### Option A: Expand Re-injection (Recommended)
Add all reasoning-capable providers:
```typescript
const REASONING_PROVIDERS = new Set([
  'openai',      // o1, o3 models
  'anthropic',   // Claude with thinking
  'gemini',      // Gemini with thinking
  'fireworks',   // DeepSeek, etc.
  'openrouter'   // Various models
])
```

Add model detection:
```typescript
function supportsReasoning(provider: string, model: string): boolean {
  if (provider === 'openai') return /^o[13](-|$)/i.test(model)
  if (provider === 'anthropic') return /claude-(4|opus|sonnet-4|3-7|3\.5-sonnet)/i.test(model)
  if (provider === 'gemini') return /gemini-2\.(0|5)-(pro|flash)/i.test(model)
  return ['fireworks', 'openrouter'].includes(provider)
}
```

### Option B: Disable Persistence
Don't store reasoning in session history at all:
```typescript
// Only emit for UI, don't persist
if (step.reasoning) {
  emit?.({ type: 'reasoning', ... })
  // Don't add to contextManager
}
```

### Option C: Make It Configurable
Add a flag to control persistence per session.

---

## Recommendation

**Go with Option A** because:
1. ✅ Maintains conversation continuity
2. ✅ Improves model accuracy for reasoning models
3. ✅ Aligns with how reasoning models are designed
4. ✅ Minimal code changes
5. ✅ Backward compatible

---

## Next Steps

1. **Decide:** Which option do you prefer?
2. **Implement:** Expand re-injection to all providers
3. **Test:** Verify with o1, Claude thinking, Gemini thinking
4. **Monitor:** Check token usage and accuracy

---

## Files to Update

1. `electron/flow-engine/llm/payloads.ts`
   - Expand `OPENAI_REASONING_PROVIDERS`
   - Add `supportsReasoning()` function
   - Update `formatMessagesForOpenAI()`

2. `electron/flow-engine/llm/payloads.ts` (or new file)
   - Add reasoning handling to `formatMessagesForAnthropic()`
   - Add reasoning handling to `formatMessagesForGemini()`

---

## Bottom Line

Your instinct is correct - reasoning should be included in prompts across loops, but **only for models that support it**. Your current implementation stores it for everyone but only uses it for 2 providers. The fix is straightforward: expand the re-injection to all reasoning-capable providers.

