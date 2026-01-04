---
id: e51cc6de-2de8-453b-86b9-d99960e2a859
title: Indexing and Parsing Workers Infrastructure
tags: [indexing, parsing, child-process, architecture, stability]
files: [electron/workers/indexing/parser-worker.js, electron/workers/indexing/discovery-worker.js, electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T05:35:53.503Z
updatedAt: 2026-01-04T16:33:23.136Z
---

# Indexing and Parsing Workers Infrastructure

The indexing system uses separate processes to offload heavy I/O and CPU bound tasks from the main Electron process. This architecture ensures the UI remains responsive even during intensive indexing of large codebases.

## Architecture Change (Child Processes)

Previously, this system used `worker_threads`. However, due to native module instability (specifically `tree-sitter` bindings) causing heap corruption and application crashes on Windows, the system has been migrated to use `child_process.fork`.

- **Isolation:** Each worker runs in a separate OS process. If a native module crashes, only that child process dies; the main application remains stable.
- **Communication:** Communication is handled via a WebSocket bus (JSON-RPC), preserving the same protocol as the previous Worker Thread implementation. Child processes connect to the local WebSocket server started by the main process.

## Components

### 1. CodeIndexerService
- **Role:** Orchestrates the indexing process.
- **Mechanism:** Spawns `parser-worker.js` and `discovery-worker.js` using `fork`.
- **Communication:** Sends JSON-RPC requests (`parse`, `discover`) to workers via `WorkerWsTransport`.

### 2. Discovery Worker (`discovery-worker.js`)
- **Role:** Scans the workspace for files, respecting `.gitignore`.
- **Output:** Returns a list of file paths to be indexed.
- **Process:** Runs as a standalone Node.js process.

### 3. Parser Worker (`parser-worker.js`)
- **Role:** Parses code files into ASTs and generates code chunks.
- **Dependencies:** Uses `tree-sitter` and language bindings (TypeScript, Go, Rust, Python).
- **Process:** Runs as a standalone Node.js process (multiple instances can be spawned for parallelism).

## Crash Mitigation
The switch to Child Processes is the primary mitigation strategy for `0xC0000374` (Heap Corruption) crashes associated with `tree-sitter` in Electron Worker Threads.

## Configuration
Workers are configured via environment variables passed during `fork`:
- `WS_URL`: WebSocket server URL.
- `WS_TOKEN`: Authentication token.
- `WORKER_ID`: Unique identifier for logging.
