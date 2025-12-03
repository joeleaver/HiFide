---
id: 6d7cd423-872d-4e62-9665-8c7af57c60cf
title: Flow context manager + multi-context lifecycle
tags: [flow-engine, context, scheduler, llm]
files: [electron/flow-engine/contextRegistry.ts, electron/flow-engine/scheduler.ts, electron/services/FlowContextsService.ts, electron/backend/ws/event-subscriptions.ts, electron/backend/ws/snapshot.ts, src/store/flowContexts.ts, src/components/ContextInspectorPanel.tsx, electron/flow-engine/__tests__/scheduler-multi-context-routing.test.ts, electron/flow-engine/__tests__/scheduler-multi-context-integration.test.ts]
createdAt: 2025-12-03T19:47:15.558Z
updatedAt: 2025-12-03T21:49:59.891Z
---

- FlowScheduler now sources all contexts from ContextRegistry. Each node’s FlowAPI includes a `contexts` helper (active/list/get/createIsolated/release) so new isolated contexts inherit metadata (label, parentContextId, createdByNodeId, createdAt) and always publish through FlowContextsService. Registry snapshots are the single source of truth for websocket state.
- FlowContextsService broadcasts `{ requestId, updatedAt, mainContext, isolatedContexts }` for every workspace. Hydration snapshots and the `useFlowContexts` store persist the same payload, so the renderer can show the active run + timestamp in `ContextInspectorPanel`.
- `initFlowContextsEvents` now acquires a backend client (no-op if unavailable) and directly forwards each payload to `setContexts`, which normalizes request IDs, timestamps, and context maps. The inspector uses memoized helpers to print the first eight characters of the active `requestId` and a localized `updatedAt` label above the tab strip.
- Scheduler publishes/clears FlowContextsService state on start, flush, cancel, and error paths to avoid stale contexts. Tests cover registry inheritance plus websocket lifecycle, including a new portal-routing regression test proving bridged context edges continue to deliver the active binding even when nodes omit `context` outputs.
- `scheduler-multi-context-integration.test.ts` simulates the defaultContextStart → isolated branch → worker → release path. It asserts FlowContextsService advertises isolated contexts during execution, that release returns control to the main binding, and that session flushes never pick up isolated history.