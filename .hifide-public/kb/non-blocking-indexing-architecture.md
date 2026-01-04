---
id: f686e4bd-f721-4b88-acc9-c28f03a20f85
title: Non-Blocking Indexing Architecture
tags: []
files: []
createdAt: 2026-01-03T23:58:17.411Z
updatedAt: 2026-01-03T23:58:17.411Z
---

## Non-Blocking Indexing Architecture

The system uses a two-tier non-blocking strategy to ensure the Electron UI remains responsive even during heavy background operations:

### 1. The Orchestrator Queue
All indexing operations (full re-indexes, file changes, deletions) are enqueued in `IndexOrchestratorService.ts`. 
- **Sequential Background Processing**: Jobs are popped and processed one-by-one.
- **Micro-Yields**: Before each job starts, it calls `setImmediate` to allow the event loop to flush UI-critical IPC and timer callbacks.
- **Inter-Job Sleep**: A `100ms` window between jobs ensures the CPU isn't fully saturated.

### 2. Inner-Loop Batch Yielding
The individual indexers (`CodeIndexerService`, `KBIndexerService`, `MemoriesIndexerService`) implement batching:
- **Batch Processing**: Files are processed in groups (typically 10).
- **Hard Yields**: After each batch, the service calls `setTimeout(resolve, 50)`. This forces a context switch back to the main thread's event loop, preventing the "Application Not Responding" (ANR) state in Windows/Linux/macOS.

### Status Reporting
- The orchestrator maintains `queueLength` and `currentTask` state.
- The UI can subscribe to these to show a "Background Tasks" progress indicator without blocking user interaction with the editor or settings.