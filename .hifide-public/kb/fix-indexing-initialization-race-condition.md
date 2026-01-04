---
id: 169824b2-9c1d-42ae-99cd-9977787988f5
title: Fix Indexing Initialization Race Condition
tags: [bugfix, race-condition, indexing, initialization]
files: [electron/services/vector/IndexOrchestratorService.ts, electron/services/FlowGraphService.ts, electron/services/WorkspaceService.ts]
createdAt: 2026-01-04T03:16:34.993Z
updatedAt: 2026-01-04T03:16:34.993Z
---

Fixed a race condition where the `IndexOrchestratorService` would start indexing (and consequently initializing worker threads) before the workspace flow graph had fully hydrated. This was causing `FlowGraphService.getGraph` to return empty graphs, and in some cases, contributing to native crashes (exit code 4294930435) because of I/O saturation or uninitialized state during early boot.

The fix involves adding a polling mechanism in `IndexOrchestratorService.runStartupCheck()` that waits for `FlowGraphService` to report a non-empty node list for the active workspace (up to a 10-second timeout) before proceeding with index validation and worker initialization.

Affected files:
- `electron/services/vector/IndexOrchestratorService.ts`