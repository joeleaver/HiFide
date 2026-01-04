---
id: b96b2f54-8d4c-4a92-9a49-4cc2fcd30110
title: Debugging Indexing Crashes during Discovery
tags: [indexing, workers, crash, discovery]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T03:22:58.736Z
updatedAt: 2026-01-04T03:22:58.736Z
---

## Indexing Crash (Discovery Phase)

### Symptoms
The application crashes with exit code `4294930435` (typically `0xFFFFFFFF`) or reports a `crashpad` "not connected" error shortly after logging `[CodeIndexerService] Starting offloaded discovery`.

### Analysis
The crash is likely a native C++ level crash in Node.js worker threads or the Electron main process, possibly triggered by:
1.  **V8/Crashpad Mismatch:** Rapid termination and recreation of worker threads can lead to "!flush_tasks_" or pipe/socket connection errors in the native crashpad client.
2.  **Resource Exhaustion:** Heavy disk I/O or memory pressure during file discovery (`globby`).
3.  **IPC Overhead:** Excessive logging or message passing saturating the IPC channel.

### Mitigation
1.  **Graceful Termination:** Wait for workers to exit with a timeout. Do not just `terminate()` and immediately proceed.
2.  **IPC Draining:** Ensure `stdout`/`stderr` of worker threads are consumed (drained) even if not logged, to prevent pipe blockages.
3.  **Error Handling:** Add explicit `try/catch` and `console.error` inside worker threads to capture errors before they bubble up to native crashes.
4.  **Logging Filter:** Filter out known noise (like Chromium's internal logs) from the worker stderr to keep the main process log clean.

### Related Code
- `electron/services/vector/CodeIndexerService.ts`
- `electron/workers/indexing/discovery-worker.js`
