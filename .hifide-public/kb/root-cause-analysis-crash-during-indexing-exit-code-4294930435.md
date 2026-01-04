---
id: fda3f7ae-d8ba-48f9-961f-9d2a8817ab31
title: Root Cause Analysis: Crash during Indexing (Exit Code 4294930435)
tags: [crash, indexing, worker-threads, bug-fix]
files: [electron/services/vector/CodeIndexerService.ts, electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T03:25:47.552Z
updatedAt: 2026-01-04T03:25:47.552Z
---

## Problem
The application experienced a fatal crash (exit code `4294930435`, often related to memory access violations or unhandled native pipe errors in Node.js) during the background indexing phase. Logs indicated the crash occurred shortly after `CodeIndexerService` initialized worker threads and started file discovery.

## Root Cause Hypothesis
1. **Unconsumed Worker Streams**: Node.js `worker_threads` with `stdout: true` and `stderr: true` must have their streams consumed. If the internal buffers (typically 64KB) fill up and the main thread hasn't drained them, the worker can hang or the process can crash when attempting to write to a closed/full pipe.
2. **Rapid Termination/Re-initialization**: During startup, `IndexOrchestratorService` calls `stopAll()` which triggers `getCodeIndexerService().reset()`. If `reset()` (which terminates workers) is called while workers are still spinning up or performing I/O, it can lead to race conditions in the native `libuv` layer.
3. **Missing Await on Indexing**: `IndexOrchestratorService` uses `getCodeIndexerService().reset()` in several places without awaiting it if it were async, but more importantly, the `stopAll` implementation in `IndexOrchestratorService` was not properly awaiting the cleanup of `CodeIndexerService` and `KBIndexerService`.

## Fix Strategy
1. **Ensure Async Reset**: Make `reset()` in all indexers `async` and properly `await` worker termination.
2. **Safe Stream Handling**: Implement robust draining of `stdout` and `stderr` in `CodeIndexerService`.
3. **Orchestrator Safety**: Update `IndexOrchestratorService.stopAll()` to `await` the indexers' reset methods.
4. **Debounce Indexing**: Add a brief cooldown between stopping and starting indexing to allow the OS to reclaim file handles and flush pipes.

## Implementation Details
- `CodeIndexerService.reset()` now returns `Promise<void>` and uses `worker.terminate()`.
- `IndexOrchestratorService.stopAll()` now `await`s these resets.
- `CodeIndexerService.setupWorkerListeners` includes logic to pipe or drain `stdout`/`stderr`.