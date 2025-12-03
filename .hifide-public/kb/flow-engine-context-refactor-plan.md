---
id: dfb99ffc-0124-42de-9293-85272a2a93e4
title: Flow engine context refactor plan
tags: [flow, context, design]
files: [electron/services/FlowContextsService.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/contextManager.ts, electron/flow-engine/nodes]
createdAt: 2025-12-03T18:54:30.988Z
updatedAt: 2025-12-03T18:59:49.760Z
---

## Summary
Implement a single-writer context architecture with multi-context support by introducing a scheduler-managed context registry, context service for UI sync, and per-context FlowAPI bindings. The FlowScheduler becomes the source of truth for all contexts, publishes state through FlowContextsService, and clears context snapshots when executions stop.

## Key Points
- Add `FlowContextsService` in `electron/services` to track `{ mainContext, isolatedContexts, requestId }` per workspace, broadcast `flow.contexts.changed` events, and clear entries when flows end.
- Extend `ContextManager` (in `electron/flow-engine/contextManager.ts`) with in-place mutation helpers (`update`, `replaceHistory`) and keep a dedicated manager per context binding.
- FlowScheduler maintains a registry of contexts (main + isolated), resolves the active context for each node execution, binds it into `createFlowAPI`, and now publishes the initial context plus clears workspace state after cancellation/error.
- Nodes mutate context exclusively through their provided manager; scheduler automatically propagates context handles downstream and registers new isolated contexts created via `flow.contexts.createIsolated`.
- After mutations, scheduler publishes context snapshots while flows run; FlowContextsService updates the renderer store via `flow.contexts.changed`.
