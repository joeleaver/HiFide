---
id: 9e720b9a-13d1-430e-aa5d-cf54ebf8be86
title: Fireworks Provider Implementation
tags: [fireworks, provider, ai-sdk, troubleshooting]
files: []
createdAt: 2025-12-06T20:58:05.850Z
updatedAt: 2025-12-06T20:58:05.850Z
---

# Fireworks Provider Implementation

## Overview
The Fireworks provider (`electron/providers-ai-sdk/fireworks.ts`) integrates with the Fireworks API using the Vercel AI SDK. It supports standard text generation, tool calling, and "thinking" models (like DeepSeek R1).

## Architecture
- **Adapter Pattern:** Implements `ProviderAdapter` interface.
- **AI SDK Integration:** Uses `createFireworks`, `streamText`, and `extractReasoningMiddleware`.
- **Reasoning Support:** 
  - Wraps the model with `extractReasoningMiddleware({ tagName: 'think' })` to support `<think>` tags.
  - Emits `reasoning` events which are rendered separately in the UI.

## Key Configuration
- **Parallel Tool Calls:** Must be set to `true` (`parallelToolCalls: true`) to support modern models like DeepSeek R1/V3. Disabling this can cause parsing errors.
- **Tool Choice:** Defaults to `'auto'` when tools are present.

## Troubleshooting

### "None" Artifacts
**Issue:** Users may see the word "None" appearing before thinking blocks or after tool calls.
**Cause:** Some models (e.g., DeepSeek R1 on Fireworks) occasionally output "None" as a text artifact before starting a thinking block or after a tool call.
**Fix:** The provider implementation includes a buffering strategy to detect and filter out standalone "None" text chunks that immediately precede reasoning or other events.
- **Logic:** Text is buffered. If the buffer equals "None" and a `reasoning-delta` arrives, the buffer is discarded. Partial matches (e.g. "No") that turn into longer words (e.g. "Note") are preserved.

### Tool Call Parsing Failures
**Issue:** Tool calls are ignored or malformed.
**Cause:** Often due to `parallelToolCalls: false`.
**Fix:** Ensure `parallelToolCalls: true` is set in `streamText`.

### Duplicate Events
**Issue:** UI shows duplicate tool executions or "Running..." badges.
**Cause:** Redundant `onToolStart` emissions for both `tool-input-start` and `tool-call`.
**Fix:** The provider uses a `seenStarts` Set to ensure `onToolStart` is emitted only once per tool call ID.