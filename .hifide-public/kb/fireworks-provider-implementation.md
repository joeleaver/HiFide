---
id: cc944c1b-3494-4483-95d6-bfca7aa2d038
title: Fireworks Provider Implementation
tags: [provider, fireworks, thinking, tool-calling]
files: []
createdAt: 2025-12-06T16:18:47.573Z
updatedAt: 2025-12-06T16:18:47.573Z
---

# Fireworks Provider Implementation

The Fireworks provider adapter in `electron/providers-ai-sdk/fireworks.ts` supports standard tool calling and "thinking" models (like DeepSeek R1).

## Key Implementation Details

1.  **Thinking Support**:
    - Wraps the model with `extractReasoningMiddleware({ tagName: 'think' })`.
    - Automatically extracts content within `<think>` tags and emits `reasoning` events.
    - Compatible with models like `deepseek-r1`, `kimi-k2-thinking`, etc.

2.  **Tool Calling**:
    - Uses `streamText` from standard AI SDK.
    - **Parallel Tool Calls**: Enabled (`parallelToolCalls: true`) to support modern models that may output multiple tool calls in a single step.
    - **Event Handling**: Tracks `seenStarts` to prevent duplicate `onToolStart` events (which can happen if both `tool-input-start` and `tool-call` chunks are processed without checks).

## Troubleshooting

-   **Tool Calls Not Parsed**: Ensure `parallelToolCalls` is set to `true` (default in updated implementation). If `false`, some models may error or produce unparseable output.
-   **Duplicate Tool Badges**: If you see multiple badges for the same tool call, check the `seenStarts` logic in `onChunk`.
-   **Missing Reasoning**: Ensure the model is actually outputting `<think>` tags. Some models might need specific parameters (though currently we rely on tag extraction).
-   **Debug Mode**: Enable verbose logging by setting environment variable `HF_AI_SDK_DEBUG=1`.
