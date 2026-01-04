---
id: b0147774-5000-4ec7-9349-cc6a2de669fb
title: Code Indexing Architecture & RPC Flow
tags: [architecture, indexing, rpc, workers]
files: []
createdAt: 2026-01-04T16:09:31.234Z
updatedAt: 2026-01-04T16:09:31.234Z
---

## Code Indexing Architecture

The code indexing system uses a multi-threaded architecture to ensure the main Electron process remains responsive.

### Components

1.  **IndexOrchestratorService**: Manages the job queue for indexing tasks (Code, KB, Memories). It handles full workspace indexing and incremental file changes.
2.  **CodeIndexerService**: Specifically handles code files. It manages a pool of worker threads.
3.  **Workers**:
    *   `discovery-worker.js`: Recursively scans the workspace for files, respecting `.gitignore`.
    *   `parser-worker.js`: Uses `tree-sitter` to parse code files into AST-based chunks.
4.  **WorkerWsTransport**: A JSON-RPC over WebSocket bridge that allows worker threads to communicate with the main process's service layer.

### Communication Flow

1.  `IndexOrchestratorService` enqueues an `index_file` or `index_workspace` job.
2.  `CodeIndexerService.indexWorkspace` is called.
3.  It initializes workers and uses `WorkerWsTransport` to send a `discover` request.
4.  The `discovery-worker` receives the request, scans files, and sends them back (potentially in chunks via `discovery-chunk` notifications).
5.  `CodeIndexerService` then iterates through files and sends `parse` requests to the `parser-worker` pool.
6.  Results are upserted into LanceDB via `VectorService`.

### RPC Methods

The WebSocket server in the Main process must expose the following methods for the workers to call back or for the service to delegate work:

*   `discover`: Scans workspace for files.
*   `parse`: Parses a specific file.
*   `discovery-chunk`: (Notification) Sent by discovery worker for large file lists.

### Troubleshooting "Method not found"

If you see "Method not found" for `discover` or `parse` in the logs, it means the WebSocket server handlers in `electron/backend/ws/handlers/vector-handlers.ts` are missing the corresponding `addMethod` calls. these should be delegated via `indexerHandlers` to the `CodeIndexerService`.