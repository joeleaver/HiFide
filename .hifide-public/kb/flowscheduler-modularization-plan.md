---
id: 0727e312-08ac-4f69-aabd-66b65b8fb697
title: FlowScheduler modularization plan
tags: [flow-engine, scheduler, architecture, plan]
files: [electron/flow-engine/scheduler.ts, electron/flow-engine/flow-node-runner.ts, electron/flow-engine/context-lifecycle-manager.ts, electron/flow-engine/cancellation.ts, electron/flow-engine/__tests__/scheduler-context-isolation.test.ts]
createdAt: 2025-12-04T16:21:35.545Z
updatedAt: 2025-12-04T16:38:54.970Z
---

## Goal
FlowScheduler is still an ~1k line monolith despite earlier extractions. We need to split it into focused collaborators so the class only orchestrates flow execution.

## Implemented architecture
1. **ContextLifecycleManager** (`electron/flow-engine/context-lifecycle-manager.ts`)
   - Owns `ContextRegistry`, publishing/clearing state through `FlowContextsService`, and handles binding resolution, isolated context creation, and provider/model updates.
   - FlowScheduler now obtains `mainBinding`, `mainContext`, and registry handles via this manager instead of duplicating the logic inline.

2. **FlowNodeRunner** (`electron/flow-engine/flow-node-runner.ts`)
   - Encapsulates the former `doExecuteNode` body: config lookup, FlowAPI creation, node invocation, execution event emission, and context flush/publish.
   - Reports node start/end via callbacks so FlowScheduler only tracks active node IDs and handles successor fan-out.

3. **Scheduler orchestration** (`electron/flow-engine/scheduler.ts`)
   - `executeNode` now delegates to `FlowNodeRunner` and defers push-phase routing to a dedicated `pushSuccessors` helper.
   - Cancellation handling moved into a shared `isCancellationError` helper (`electron/flow-engine/cancellation.ts`).
   - Portal triggers, user input resolution, and snapshots now consume the modular services rather than relying on monolithic state.

4. **Tests**
   - `scheduler-context-isolation.test.ts` now hooks the `nodeRunner.run` surface to capture contexts instead of patching the removed `doExecuteNode` method.

Running `pnpm test scheduler-context-isolation` verifies the new structure.
