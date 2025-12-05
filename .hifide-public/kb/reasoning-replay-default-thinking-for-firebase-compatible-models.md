---
id: 10221fbc-d31b-435f-8122-3cb2503f339a
title: Reasoning replay & default thinking for Firebase-compatible models
tags: [llm, reasoning, gemini, fireworks, thinking]
files: [electron/flow-engine/llm/payloads.ts, electron/flow-engine/llm-service.ts, electron/services/SessionService.ts, electron/backend/ws/workspace-loader.ts, electron/backend/ws/handlers/session-handlers.ts]
createdAt: 2025-12-05T01:23:08.788Z
updatedAt: 2025-12-05T01:23:08.788Z
---

Some providers (notably Gemini via Firebase and Fireworks reasoning models) require the model’s reasoning trace to be present in the conversation history for subsequent tool calls to behave correctly. We already capture reasoning chunks in `LLMService` via `emit({ type: 'reasoning'… })`, but the formatted payloads discarded that data.

Design decisions:
- `formatMessagesForOpenAI` now accepts the provider id and re-injects any stored `message.reasoning` for assistant turns that target Fireworks models. The reasoning is wrapped in `<think>…</think>` ahead of the assistant’s visible reply so the provider receives the same structure it emitted.
- `formatMessagesForGemini` emits reasoning as an initial `<think>…</think>` part on assistant turns so Gemini/Firebase tool routers see the original chain-of-thought alongside the final answer.

Thinking defaults:
- Session contexts now set `includeThoughts` to `true` (and `thinkingBudget` to 2048 tokens) when no explicit preference is stored. The same defaults are applied when building the `initialContext` for flow execution, so legacy sessions created before this change also opt into thinking unless they explicitly disabled it.
- The existing `resolveSamplingControls` logic continues to gate provider calls so only models that actually support thinking receive the `includeThoughts`/`thinkingBudget` options.

Key files: `electron/flow-engine/llm/payloads.ts`, `electron/services/SessionService.ts`, `electron/backend/ws/workspace-loader.ts`, `electron/backend/ws/handlers/session-handlers.ts`.