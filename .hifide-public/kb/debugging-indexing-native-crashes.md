---
id: ae836e9c-d799-4782-8d0e-c1af4930559b
title: Debugging Indexing Native Crashes
tags: [troubleshooting, indexing, electron, workers]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:10:20.083Z
updatedAt: 2026-01-04T03:10:20.083Z
---

## Troubleshooting Native Crashes in Indexer Worker

### Error: crashpad_client_win.cc(868): not connected
This error, often accompanied by exit code `4294930435`, usually indicates an Electron/Node worker thread crashing due to:
1. **Pipe Saturation:** If a worker emits massive amounts of stdout/stderr that aren't drained, the underlying IPC channel can hang or crash.
2. **Race Conditions during Reset:** Rapidly calling `worker.terminate()` followed by `new Worker()` can cause native assertions (like `!flush_tasks_`) in the V8 environment.
3. **Memory Spikes:** Large files can cause workers to hit memory limits, triggering a hard crash.

### Solutions Implemented:
1. **Draining Pipes:** Added explicit `on('data')` listeners to `worker.stdout` and `worker.stderr` in `CodeIndexerService` to ensure buffers are emptied.
2. **Cooldown Period:** Added a 500ms `setTimeout` after `worker.terminate()` during index resets to allow for OS-level cleanup.
3. **Resource Limits:** Added `resourceLimits: { maxOldSpaceSize: 512 }` to worker initialization to contain memory usage.
4. **Improved Error Handling:** Enhanced `setupWorkerListeners` to `removeAllListeners` and reject all pending tasks immediately upon failure, preventing a cascade of hanging promises.