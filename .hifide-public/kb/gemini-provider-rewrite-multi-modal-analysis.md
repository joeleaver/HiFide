---
id: edd807d2-22c8-4a89-9969-9caee1475b2e
title: Gemini Provider Rewrite & Multi-modal Analysis
tags: [gemini, multi-modal, ai-sdk, bugfix, images, pdf]
files: [electron/providers-ai-sdk/gemini.ts]
createdAt: 2026-01-03T05:12:13.795Z
updatedAt: 2026-01-03T05:28:31.480Z
---

# Gemini Provider Rewrite & Multi-modal Analysis

## Context
The Gemini provider was initially considered for a rewrite from AI SDK to the native Google SDK to address multi-modal (image/file) issues.

## Diagnosis
It was discovered that the Gemini model via the `@ai-sdk/google` provider does not support standard `type: 'image'` message parts. Instead, it uses a generic `type: 'file'` format for all non-text multi-modal inputs, including images and PDFs.

## Solution
Modified `electron/providers-ai-sdk/gemini.ts` to map `inline_data` parts to the `file` type expected by the AI SDK Google provider.

### Correct Mapping Format:
```typescript
{
  type: 'file',
  data: Buffer,
  mediaType: string // e.g., 'image/png', 'application/pdf'
}
```

## Advantages of Staying on AI SDK
1. **Agentic Loop:** AI SDK handles `maxSteps` and automatic tool execution.
2. **Standardization:** Maintains a consistent interface with other providers (OpenAI, Anthropic).
3. **Reasoning:** Supports "Thinking" models via a unified `thinkingConfig`.

## Change History
- **Image Fix (Attempt 1):** Converted base64 to `Buffer` but kept `type: 'image'`. (Failed: model hallucinated).
- **File Fix (Final):** Changed part type to `file` and provided `data` as `Buffer` with `mediaType`. (Correct according to AI SDK docs).