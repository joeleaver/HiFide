---
id: 15893d82-1346-43e1-9644-b0bc11277d8d
title: Fix: Cannot re-index: no root path set
tags: [bugfix, indexing, orchestrator]
files: [electron/services/indexing/IndexOrchestrator.ts, electron/backend/ws/service-handlers.ts]
createdAt: 2026-01-04T17:41:42.114Z
updatedAt: 2026-01-04T17:41:42.114Z
---

# Fix: "Cannot re-index: no root path set" Error

## Issue
When clicking the "Re-index" button in the settings or triggering a re-index via RPC, the `IndexOrchestrator` would fail with the error:
`[IndexOrchestrator] Cannot re-index: no root path set`

## Root Cause
The `IndexOrchestrator.indexAll()` method required `this.rootPath` to be already set (usually via `start()` or `runStartupCheck()`). However, the `indexerHandlers.indexWorkspace` handler called `indexAll()` without ensuring the orchestrator had been initialized with a root path. If the orchestrator was idle or hadn't been started with a path yet, the re-index would fail.

## Fix
1.  Modified `IndexOrchestrator.indexAll(force, rootPath?)` to accept an optional `rootPath`.
2.  If `rootPath` is provided, it updates `this.rootPath`.
3.  Updated `indexerHandlers.indexWorkspace` in `electron/backend/ws/service-handlers.ts` to pass the resolved `workspaceRoot` to `indexAll()`.

## Files Modified
*   `electron/services/indexing/IndexOrchestrator.ts`
*   `electron/backend/ws/service-handlers.ts`
