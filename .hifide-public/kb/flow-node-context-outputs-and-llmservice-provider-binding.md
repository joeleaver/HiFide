---
id: e9eb61b9-04bc-43d6-9ee3-3f02818cce23
title: Flow node context outputs and LLMService provider binding
tags: []
files: []
createdAt: 2025-12-03T20:26:08.998Z
updatedAt: 2025-12-03T20:26:08.998Z
---

- **NodeOutput contract:** Every flow node must return the active context through `context: flow.context.get()` (or the relevant `ContextManager`) on both success and error paths. `manualInput`, `injectMessages`, `llmRequest`, and `userInput` now mutate history via the scheduler-owned `ContextManager` and return the latest snapshot so downstream context edges stay hydrated.
- **LLMService context handling:** `llmService.chat` resolves provider/model from the scheduler-managed context, registers mutations exclusively through the bound `ContextManager`, and recomputes a working snapshot after appending user turns. The service now reads provider adapters from `core/state.providers`, validates the adapter/key before streaming, and emits execution events (including `usage_breakdown`) without manually setting `nodeId`/`executionId` (the FlowAPI emitter handles those).
- **Usage breakdown safety:** Token accounting now guards optional fields (e.g., `__bdSystemText`) before calling the tokenizer to avoid `string | undefined` type errors, and the breakdown payload always references `effectiveProvider`/`effectiveModel` for renderer accuracy.