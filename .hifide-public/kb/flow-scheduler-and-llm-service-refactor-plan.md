---
id: b63a266e-90b9-4ea0-80cd-464213ce5ebc
title: Flow scheduler and LLM service refactor plan
tags: [flow, scheduler, llm-service, refactor, plan]
files: [electron/flow-engine/scheduler.ts, electron/flow-engine/flow-api-factory.ts, electron/flow-engine/flow-graph.ts, electron/flow-engine/node-io-coordinator.ts, electron/flow-engine/execution-event-router.ts, electron/flow-engine/llm-service.ts]
createdAt: 2025-12-04T15:06:59.464Z
updatedAt: 2025-12-04T16:06:14.971Z
---

## Summary
We split FlowScheduler responsibilities into dedicated modules. `flow-graph.ts` owns graph construction/canonicalization, `node-io-coordinator.ts` tracks push/pull state, and the new `flow-api-factory.ts` + `execution-event-router.ts` encapsulate FlowAPI creation and renderer event routing. FlowScheduler now orchestrates dependencies through these helpers.

LLMService still carries the legacy architecture but we removed the duplicate payload/formatting helpers from the file and now import them from `electron/flow-engine/llm/payloads.ts`. This removes the redundant logging/formatting code and keeps the file focused on provider orchestration.

## Next steps
* Adopt `createTokenCounter`, `ToolUsageTracker`, and `UsageAccumulator` inside `llm-service.ts` so we can delete the remaining `__tokenCounter/__tool*` scaffolding.
* Replace the ad-hoc sampling logic with `resolveSamplingControls` to keep provider overrides centralized.
* Continue extracting renderer-specific config panes (NodeConfig) into subcomponents to keep the renderer manageable once FlowScheduler/LLMService land.
