# Reasoning Persistence: Recommendations

## Summary

You've identified a real inconsistency:
- **Reasoning is stored** in session history for ALL providers
- **Reasoning is re-injected** only for Fireworks and OpenRouter
- **Other reasoning-capable providers** (OpenAI o1/o3, Anthropic, Gemini) don't get their reasoning back

---

## The Core Question

**Should reasoning be included in user prompts across agent loops?**

### Answer: YES, but only for reasoning-capable models

**Why:**
1. **Reasoning models are designed to see their own thinking** - They use it to maintain context
2. **Improves multi-turn accuracy** - Model understands its previous reasoning
3. **Maintains conversation continuity** - User sees the full thought process
4. **Aligns with model design** - o1, Claude thinking, Gemini thinking all expect this

**But NOT for:**
- Regular models (GPT-4o, Claude 3.5 Sonnet without thinking)
- Models that don't support reasoning
- When reasoning is disabled

---

## Current Issues

### Issue 1: Incomplete Re-injection
```typescript
// payloads.ts:4
const OPENAI_REASONING_PROVIDERS = new Set(['fireworks', 'openrouter'])
```

**Missing:**
- `openai` (for o1/o3 models)
- `anthropic` (for Claude with thinking)
- `gemini` (for Gemini with thinking)

### Issue 2: No Provider-Specific Formatting
- Only `formatMessagesForOpenAI` handles reasoning
- `formatMessagesForAnthropic` doesn't handle thinking
- `formatMessagesForGemini` doesn't handle thinking

### Issue 3: No Model-Level Detection
- Reasoning is re-injected regardless of model
- Should only re-inject for models that support it
- Example: Don't re-inject for GPT-4o, only for o1/o3

---

## Recommended Solution

### Step 1: Expand Provider Detection
```typescript
// payloads.ts
const REASONING_PROVIDERS = new Set([
  'openai',      // o1, o3 models
  'anthropic',   // Claude with thinking
  'gemini',      // Gemini with thinking
  'fireworks',   // DeepSeek, etc.
  'openrouter'   // Various models
])
```

### Step 2: Add Model-Level Detection
```typescript
function supportsReasoning(provider: string, model: string): boolean {
  if (provider === 'openai') return /^o[13](-|$)/i.test(model)
  if (provider === 'anthropic') return /claude-(4|opus|sonnet-4|3-7|3\.5-sonnet)/i.test(model)
  if (provider === 'gemini') return /gemini-2\.(0|5)-(pro|flash)/i.test(model)
  if (provider === 'fireworks') return true // All models might have reasoning
  if (provider === 'openrouter') return true // All models might have reasoning
  return false
}
```

### Step 3: Update formatMessagesForOpenAI
```typescript
const shouldEmbedReasoning = options?.provider && options?.model
  ? supportsReasoning(options.provider, options.model)
  : false
```

### Step 4: Update formatMessagesForAnthropic
```typescript
// Add reasoning handling for Claude thinking models
if (msg.role === 'assistant' && msg.reasoning) {
  // Anthropic format: include thinking in the message
  // (Check Anthropic API docs for exact format)
}
```

### Step 5: Update formatMessagesForGemini
```typescript
// Add reasoning handling for Gemini thinking models
if (msg.role === 'assistant' && msg.reasoning) {
  // Gemini format: include thinking as a part
  // (Check Gemini API docs for exact format)
}
```

---

## Implementation Priority

### Phase 1: Quick Fix (High Impact)
1. Expand `OPENAI_REASONING_PROVIDERS` to include all providers
2. Add model detection for o1/o3
3. Test with OpenAI o1/o3 models

### Phase 2: Provider-Specific (Medium Impact)
1. Add reasoning handling to `formatMessagesForAnthropic`
2. Add reasoning handling to `formatMessagesForGemini`
3. Test with Anthropic and Gemini thinking models

### Phase 3: Refinement (Low Impact)
1. Add xAI reasoning support (if applicable)
2. Make persistence configurable
3. Add tests for reasoning persistence

---

## Testing Checklist

- [ ] OpenAI o1/o3: Reasoning re-injected in next turn
- [ ] Anthropic Claude thinking: Thinking re-injected in next turn
- [ ] Gemini thinking: Thinking re-injected in next turn
- [ ] Regular models: Reasoning NOT re-injected (no waste)
- [ ] Multi-turn: Reasoning accumulates correctly
- [ ] Token usage: Reasoning tokens tracked separately

---

## Decision Point

**Do you want to:**
1. **Implement the fix** - Expand reasoning re-injection to all providers
2. **Disable reasoning persistence** - Don't store reasoning in session history
3. **Make it configurable** - Add a flag to control persistence per session

**Recommendation:** Option 1 (Implement the fix)
- Maintains conversation continuity
- Improves model accuracy
- Aligns with model design
- Minimal code changes

