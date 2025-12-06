---
id: 575f047b-8d31-4ecc-8a64-4934ba30d6d9
title: Fireworks Provider Implementation
tags: [fireworks, provider, troubleshooting, deepseek]
files: []
createdAt: 2025-12-06T21:14:49.115Z
updatedAt: 2025-12-06T21:14:49.115Z
---

# Fireworks Provider Implementation

## Overview
The Fireworks provider is integrated via `@ai-sdk/fireworks`. It supports tool calling and reasoning models (like DeepSeek R1).

## Architecture
- **Adapter:** `electron/providers-ai-sdk/fireworks.ts`
- **Reasoning:** Uses `extractReasoningMiddleware` to parse `<think>` tags into `reasoning` chunks.
- **Tool Calling:** `parallelToolCalls` is enabled (`true`) to support models that output multiple tools or tool calls alongside reasoning.

## Troubleshooting

### "None" Artifacts
**Issue:** Some models (e.g., DeepSeek R1 on Fireworks) emit a standalone "None" text chunk after tool execution or before reasoning blocks. This appears in the UI as the word "None".
**Cause:** Likely a leakage of a Python `None` return value or a specific stop token artifact from the provider.
**Fix:** The provider adapter includes a buffering mechanism in `agentStream`. It buffers text and drops chunks that are exactly `"None"` (or `"None
"`) if no other text has been emitted in the current sequence.
**Logic:**
- Buffers text chunks.
- If buffer matches `"None"` (trimmed), it waits.
- If it diverges (e.g., `"None of"`), it flushes.
- If the buffer is `"None"` at the end of a step or before a tool call/reasoning block, it is dropped.
- This preserves valid responses like "None of the above" while removing the artifact.

### Reasoning Display
Reasoning is rendered in the `SessionPane` using a `Markdown` component within a quoted block. It supports markdown formatting (lists, code blocks) but does not use `pre-wrap` whitespace to avoid layout issues with the markdown renderer.

### Tool Calling
- **Parallel Calls:** Must be `true` for R1.
- **Tool Input:** Handled via `tool-input-start` and `tool-call` events. The provider ensures proper event sequence.
