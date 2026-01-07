# Reasoning Persistence Analysis: Session vs Agent Loop

## The Two Contexts

### 1. **Within Agent Loop** (Single LLM Call)
- Reasoning is extracted from streaming chunks
- Used to maintain state within the loop
- **Correct behavior:** Reasoning is re-injected in `<think>` tags for multi-step tool calls
- This is working as intended ✅

### 2. **Across Sessions** (Conversation History)
- Reasoning is stored in `messageHistory` via `message.reasoning`
- Re-injected when formatting messages for the next agent loop
- **Current behavior:** Only re-injected for `fireworks` and `openrouter` providers
- **Question:** Should reasoning be persisted across sessions at all?

---

## Current Implementation

### Storage (llm-service.ts:342-353)
```typescript
// Add reasoning if present
if (step.reasoning) {
  if (typeof step.reasoning === 'string') {
    assistantMessage.reasoning = step.reasoning
  } else {
    // ... normalize to string
  }
}
contextManager.addMessage(assistantMessage)
```

**Result:** Reasoning is stored in session history for ALL providers.

### Re-injection (payloads.ts:94, 106-111)
```typescript
const OPENAI_REASONING_PROVIDERS = new Set(['fireworks', 'openrouter'])
const shouldEmbedReasoning = options?.provider ? 
  OPENAI_REASONING_PROVIDERS.has(options.provider) : false

if (msg.role === 'assistant' && shouldEmbedReasoning) {
  const trimmedReasoning = msg.reasoning ? String(msg.reasoning).trim() : ''
  if (trimmedReasoning) {
    const suffix = content ? `\n${content}` : ''
    content = `<think>${trimmedReasoning}</think>${suffix}`
  }
}
```

**Result:** Reasoning is only re-injected for Fireworks and OpenRouter.

---

## The Problem

### Inconsistency
- Reasoning is stored for ALL providers
- But only re-injected for 2 providers
- Other providers (OpenAI, Anthropic, Gemini, xAI) ignore stored reasoning

### Missing Providers
- **OpenAI (o1/o3):** Should re-inject reasoning
- **Anthropic (Claude with thinking):** Should re-inject thinking
- **Gemini (with thinking):** Should re-inject thinking
- **xAI:** Unknown if it supports reasoning

### Token Waste
- Reasoning is stored but not used (for most providers)
- Takes up space in session history
- Increases context size for no benefit

---

## Questions to Answer

1. **Should reasoning be persisted at all?**
   - Pro: Maintains conversation continuity, shows user the model's thinking
   - Con: Wastes tokens, increases context size, may bias future responses

2. **If yes, which providers should re-inject it?**
   - Currently: `fireworks`, `openrouter`
   - Should add: `openai` (for o1/o3), `anthropic` (for thinking models), `gemini` (for thinking)
   - Unknown: `xai`

3. **Should it be configurable?**
   - Per-provider setting?
   - Per-model setting?
   - Global setting?

---

## Recommendations

### Option A: Store & Re-inject for All Reasoning Providers
**Best for:** Maintaining conversation continuity

```typescript
const REASONING_PROVIDERS = new Set([
  'openai',      // o1/o3 models
  'anthropic',   // Claude with thinking
  'gemini',      // Gemini with thinking
  'fireworks',   // DeepSeek, etc.
  'openrouter'   // Various models
])
```

**Action:** Update `formatMessagesForOpenAI` to check all providers.

### Option B: Don't Store Reasoning in Session History
**Best for:** Token efficiency

```typescript
// In llm-service.ts, don't add reasoning to messageHistory
// Only emit it for UI display
if (step.reasoning) {
  emit?.({ type: 'reasoning', ... })
  // Don't add to contextManager
}
```

**Action:** Remove reasoning storage from session history.

### Option C: Make It Configurable
**Best for:** Flexibility

```typescript
const context = contextManager.get()
const shouldPersistReasoning = context.persistReasoning ?? true
if (shouldPersistReasoning && step.reasoning) {
  assistantMessage.reasoning = step.reasoning
}
```

**Action:** Add `persistReasoning` flag to context.

---

## My Recommendation

**Option A** is best because:
1. Maintains conversation continuity
2. Helps models understand their own reasoning
3. Provides transparency to users
4. Aligns with how reasoning models are designed to work

**Action Items:**
1. Expand `OPENAI_REASONING_PROVIDERS` to include all reasoning-capable providers
2. Add provider detection for reasoning support
3. Update `formatMessagesForOpenAI` to handle all providers
4. Consider adding `formatMessagesForAnthropic` and `formatMessagesForGemini` equivalents

---

## Implementation Priority

1. **High:** Add OpenAI (o1/o3) to reasoning re-injection
2. **High:** Add Anthropic (Claude thinking) to reasoning re-injection
3. **High:** Add Gemini (thinking) to reasoning re-injection
4. **Medium:** Investigate xAI reasoning support
5. **Low:** Make persistence configurable

