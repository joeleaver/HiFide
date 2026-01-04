---
id: 50a5b091-33e3-40ea-8eac-29adcd2b95c2
title: Fix IndexOrchestrator RPC Message Mismatch
tags: [fix, rpc, indexing]
files: [electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T16:05:18.600Z
updatedAt: 2026-01-04T16:05:18.600Z
---

Fixed a 'Method not found' JSON-RPC error in `IndexOrchestratorService`.

The error was caused by a mismatch in the `action` field when queuing a full code index. The orchestrator was sending `index_workspace`, while the logic in `executeJob` was expecting `index_file` even for full workspace indexing (with `filePathOrId: '__FULL_INDEX__'`).

Specifically:
- `IndexOrchestratorService.queueFullIndex` incorrectly used `action: 'index_workspace'`.
- `IndexOrchestratorService.executeJob` for code type expects `action === 'index_file'` to branch into `indexer.indexWorkspace` or `indexer.indexFile`.

Standardized the code indexing action to `index_file` across the orchestrator queueing logic to maintain consistency with the existing type definitions and execution branches.