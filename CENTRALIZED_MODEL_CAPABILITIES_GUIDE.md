# Centralized Model Capabilities - Developer Guide

## Overview

All model capability detection is now centralized in a single module: `electron/flow-engine/llm/model-capabilities.ts`

This eliminates duplication and ensures consistent behavior across the entire codebase.

---

## The Module

**Location**: `shared/model-capabilities.ts` (accessible from both `src` and `electron`)

**Exports**:
1. `supportsReasoningEffort(model: string): boolean`
2. `supportsExtendedThinking(model: string): boolean`
3. `supportsReasoningPersistence(provider: string, model: string): boolean`
4. `getProviderFromModel(model?: string): Provider`

---

## Usage Examples

### In UI Components
```typescript
import { supportsReasoningEffort, supportsExtendedThinking } from '../../../shared/model-capabilities'

// Show reasoning effort control if model supports it
if (supportsReasoningEffort(modelId)) {
  // Render reasoning effort dropdown
}

// Show thinking controls if model supports it
if (supportsExtendedThinking(modelId)) {
  // Render thinking budget input
}
```

### In Message Formatting
```typescript
import { supportsReasoningPersistence } from '../../../shared/model-capabilities'

// Re-inject reasoning if model supports it
const shouldEmbedReasoning = supportsReasoningPersistence(provider, model)
```

### In Provider Adapters
```typescript
import { supportsExtendedThinking } from '../../shared/model-capabilities'

// Enable thinking mode if supported
if (supportsExtendedThinking(context.model) && context.includeThoughts) {
  // Add thinking config to request
}
```

---

## Adding New Model Support

### Step 1: Update shared/model-capabilities.ts

Add detection for the new model in the appropriate function:

```typescript
// Example: Add Claude 3.6 support
export function supportsExtendedThinking(model: string): boolean {
  // ... existing checks ...
  if (/claude-3-6/i.test(model)) return true
  // ... rest of function ...
}
```

### Step 2: Done!

The new model is automatically supported everywhere:
- ✅ UI controls appear
- ✅ Message formatting handles it
- ✅ Provider adapters enable features
- ✅ Stream options work correctly

No other files need changes!

---

## Model Support Matrix

| Model | Reasoning Effort | Extended Thinking | Persistence |
|-------|------------------|-------------------|-------------|
| OpenAI o1/o3 | ✅ | ❌ | ✅ |
| OpenAI gpt-5.x | ✅ | ❌ | ✅ |
| Claude 4.x | ✅ | ✅ | ✅ |
| Claude 3.7 Sonnet | ✅ | ✅ | ✅ |
| Claude 3.5 Sonnet | ✅ | ✅ | ✅ |
| Gemini 2.5+ | ✅ | ✅ | ✅ |
| Gemini 3.x | ✅ | ✅ | ✅ |
| Fireworks (all) | ✅ | ❌ | ✅ |
| OpenRouter (all) | ✅ | ✅ | ✅ |

---

## Files Using This Module

- `electron/flow-engine/llm/payloads.ts`
- `electron/flow-engine/llm/stream-options.ts`
- `src/components/FlowNode/SamplingControls.tsx`
- `electron/providers-ai-sdk/openai-openai.ts`
- `electron/providers-ai-sdk/anthropic-openai.ts`
- `electron/providers-ai-sdk/gemini-openai.ts`

---

## Status: COMPLETE ✅

Model capabilities are now centralized, maintainable, and easy to extend.

