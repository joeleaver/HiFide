---
id: 7cb9ab4a-a0c8-43f7-90be-c73e37520527
title: Fix IndexOrchestrator JSON-RPC Method not found Error
tags: [bugfix, indexing, json-rpc, orchestrator]
files: [electron/services/vector/IndexOrchestratorService.ts, electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T06:31:36.104Z
updatedAt: 2026-01-04T06:32:42.648Z
---

## 'Method not found' in IndexOrchestrator job

The error `Method not found` with code `-32601` typically occurs when the `IndexOrchestratorService` dispatches a job to a worker via JSON-RPC, but the target service (like `CodeIndexerService`) doesn't have the method registered or the call structure is wrong.

### Resolved: index_file vs index_workspace mismatch

In a previous version, `IndexOrchestratorService` was sending an `index_file` action with `filePathOrId: '__FULL_INDEX__'`. While `IndexOrchestratorService` had internal logic to divert this to `indexer.indexWorkspace()`, the naming was confusing and contributed to brittle branching logic.

**Refactor Fix:**
1. Renamed the action in `queueFullIndex` from `index_file` to `index_workspace` for the `code` type.
2. Simplified `executeJob` logic to explicitly check for `index_workspace` or `__FULL_INDEX__`.
3. Improved `currentTask` display logic to handle `__FULL_INDEX__` gracefully without crashing on `path.basename`.

### Investigation: Worker Method Registration
If the error persists *within* the `CodeIndexerService` calling its workers:
- Check `electron/workers/indexing/parser-worker.js` for `transport.addMethod('parse', ...)`.
- Check `electron/workers/indexing/discovery-worker.js` for `transport.addMethod('discover', ...)`.
- Ensure `WorkerWsTransport` is correctly routing messages between the `JSONRPCServerAndClient` and the WebSocket.

### LanceDB Issues
Note that `LanceError(IO)` or `manifest not found` are separate from JSON-RPC errors and indicate database file corruption, often requiring a full re-index (`force: true`).