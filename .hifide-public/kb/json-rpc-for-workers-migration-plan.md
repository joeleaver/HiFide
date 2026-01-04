---
id: d153e1b4-f938-4bff-9add-e75fe8b8b6f9
title: JSON-RPC for Workers Migration Plan
tags: [architecture, json-rpc, worker-threads, refactor]
files: []
createdAt: 2026-01-04T06:16:19.436Z
updatedAt: 2026-01-04T06:16:19.436Z
---

# JSON-RPC for Workers Migration Plan

## Context
The application currently uses `json-rpc-2.0` for communication between the Electron Main process and the Renderer via WebSockets. However, internal worker threads (e.g., `CodeIndexerService`) use an ad-hoc `postMessage` protocol with manual `taskId` tracking.

## Proposal
Replace the manual message handling in `worker_threads` with `json-rpc-2.0`. This will:
1. Standardize communication patterns across the entire stack.
2. Reduce boilerplate in services (removing `pendingTasks` maps and manual timeout logic).
3. Provide robust error handling and type-safe method calls.

## Implementation Strategy
1. **Shared Transport**: Create a helper to bridge `json-rpc-2.0` with `node:worker_threads` `parentPort` and `Worker` instances.
2. **Phase 1: CodeIndexerService**: Update `CodeIndexerService` to use a `JSONRPCServerAndClient` instance for its workers.
3. **Phase 2: Worker Utilities**: Update `parser-worker.js` and `discovery-worker.js` to register methods via `JSONRPCServer`.

## Benefits
- Consolidates "Request/Response" logic.
- Native support for notifications (e.g., `discovery-progress`).
- Built-in error serialization.