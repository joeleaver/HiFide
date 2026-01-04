---
id: 3b19de61-842c-4ca7-8c99-7e934b39fb71
title: Debugging Indexing Worker Crashes
tags: [electron, worker-threads, debugging, indexing]
files: []
createdAt: 2026-01-04T03:42:28.318Z
updatedAt: 2026-01-04T03:42:28.318Z
---

## Indexing Worker Crashes (Electron)

### Issue
When using Electron `Worker` threads with `stdout: true` and `stderr: true`, the application may crash with `crashpad_client_win.cc(868)] not connected` or IPC-related errors (exit code 4294930435). This is often due to a race condition or buffer saturation in the underlying pipe communication between the worker and the main process, especially when the main process is under heavy load or trying to shut down.

### Solution
1. **Disable Pipe Redirection**: Set `stdout: false` and `stderr: false` when creating the `Worker`. Use `parentPort.postMessage` for structured logging if needed.
2. **Explicit Cleanup**: Ensure `worker.terminate()` is called during service reset/shutdown and that listeners are removed to prevent "not connected" errors when the process tries to flush task queues for a dying worker.
3. **Pacing**: Avoid saturating the IPC channel with too many high-frequency messages (e.g. throttled progress updates).

### Relevant Files
- `electron/services/vector/CodeIndexerService.ts`
- `electron/workers/indexing/discovery-worker.js`
- `electron/workers/indexing/parser-worker.js`