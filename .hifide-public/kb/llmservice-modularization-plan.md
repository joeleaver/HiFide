---
id: 2d35fc0d-e6fe-4960-b386-e612ee9af2e9
title: LLMService modularization plan
tags: [flow-engine, llm, refactor, plan]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/llm/tool-policy.ts, electron/flow-engine/llm/usage-tracker.ts, electron/flow-engine/llm/stream-options.ts]
createdAt: 2025-12-04T16:51:30.153Z
updatedAt: 2025-12-04T16:57:19.569Z
---

## Context
Phase 2 of the LLMService refactor extracted helper modules from `electron/flow-engine/llm-service.ts`, which previously implemented tool policy enforcement, sampling overrides, and usage instrumentation inline. The goal was to shrink the file, delete duplicate logic, and ensure new FlowEngine components can reuse the same helpers.

## Current architecture
- `llm/tool-policy.ts` now exports `wrapToolsWithPolicy`, moving all workspace search/read throttling rules out of `llm-service.ts`.
- `llm-service.ts` imports `createTokenCounter`, `UsageAccumulator`, and `ToolUsageTracker` from `llm/usage-tracker.ts` to handle tokenizer selection, provider usage deltas, and tool I/O accounting. The service no longer touches `@dqbd/tiktoken` directly.
- `resolveSamplingControls` from `llm/stream-options.ts` drives temperature/reasoning/thought toggles so scheduler context + per-model overrides stay centralized.
- Cancellation paths rely on `UsageAccumulator.emitBestEffortUsage` to emit fallback totals exactly once, eliminating the bespoke `usageEmitted` bookkeeping.

## Implementation notes
1. Added `electron/flow-engine/llm/tool-policy.ts` and updated `llm-service.ts` to import it.
2. Replaced bespoke OpenAI encoder caching + manual tool token math with `createTokenCounter` + `ToolUsageTracker`. The usage_breakdown event now consumes the tracker snapshot to populate per-tool stats.
3. Swapped the manual sampling override block for `resolveSamplingControls`, keeping stream options logic in one place.
4. Wrapped the provider execution block in a `try/finally` to dispose token counters every request.
5. Updated the knowledge base (this entry) with the delivered changes so future refactors know the new helper locations.

Follow-ups: adopt `UsageAccumulator` more broadly (timeline metrics), migrate the remaining `onChunk` overlap logic into a reusable stream helper, and continue splitting provider-specific paths into adapter modules.