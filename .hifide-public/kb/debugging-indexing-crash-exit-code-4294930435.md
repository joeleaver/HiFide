---
id: 5d5e486a-0aad-456a-8c8e-301a545e6677
title: Debugging Indexing Crash (Exit Code 4294930435)
tags: [bug, indexing, crash, electron, worker-threads, ipc-saturation]
files: [electron/workers/indexing/discovery-worker.js, electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:27:11.245Z
updatedAt: 2026-01-04T05:46:53.759Z
---

## Root Cause Analysis
The indexing crash with exit code `4294930435` and the Electron `crashpad_client_win.cc(868): not connected` error was determined to be caused by **IPC pipe saturation**.

### Details
1. **Excessive Logging:** The `discovery-worker.js` was logging every directory scanned and every file excluded. In large workspaces (with many directories in `node_modules` or `dist`), this generated thousands of `console.log` calls in a few milliseconds.
2. **Worker-to-Main IPC:** Each `console.log` in a Worker Thread is piped to the Main Process. Flooding this pipe can cause the native worker thread management in Electron/Node to crash or disconnect, especially on Windows.
3. **Inefficient Exclusions:** The exclusion logic was calculating relative paths and running string comparisons for every single entry, even inside already excluded directories (due to the flat stack approach).

## Fixes Implemented
1. **Restricted Logging:** Removed `console.log` from the inner loop of `discovery-worker.js`. It now only logs start, finish, and progress every 2,000 files.
2. **Optimized Exclusions:** Added a `Set` of top-level directory names to ignore (`node_modules`, `.git`, etc.) to prevent even entering those directories during the walk.
3. **Safety Delays:** Increased the cooldown delay in `CodeIndexerService` before worker initialization to ensure the system state is stable.
4. **Resiliency:** Added explicit checks for worker existence before task execution.

## Verification
The crash occurred immediately after "Forced re-index: clearing existing hashes...". Reducing the log volume from the worker that starts right after that is the primary mitigation.