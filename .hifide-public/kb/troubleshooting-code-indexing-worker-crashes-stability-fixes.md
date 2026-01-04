---
id: 74625bda-10d4-4976-a830-ec01c6d48ada
title: Troubleshooting Code Indexing Worker Crashes (Stability Fixes)
tags: [indexing, stability, workers, bug-fix, crash-prevention]
files: [electron/services/vector/CodeIndexerService.ts, electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T03:24:31.979Z
updatedAt: 2026-01-04T03:29:00.777Z
---

# Troubleshooting Code Indexing Worker Crashes (Stability Fixes)

## Overview
Indexing workers operate in a multi-threaded environment using Node.js `worker_threads`. Rapid initialization/reset cycles or I/O saturation can lead to native process crashes (e.g., exit code `4294930435`).

## Common Causes
1. **I/O Saturation (Pipe Pressure)**: Workers emitting too many logs via `stdout`/`stderr`. If the main thread doesn't consume these, the 64KB internal buffer fills up, causing the worker to block and eventually crash during termination.
2. **Race Conditions during Bootstrap**: Triggering indexing (`indexAll`) immediately after workspace attachment while hydration or IPC setup is still in progress.
3. **Rapid Worker Recycle**: Calling `reset()` and `init()` in rapid succession (e.g., < 200ms) before the OS has reclaimed the underlying thread resources.

## Stability Measures (Implemented)
- **Log Dampening**: Discovery progress and worker logs are throttled or suppressed unless critical.
- **Explicit Stream Drainage**: The service now joins `on('data')` for both `stdout` and `stderr` to ensure the internal buffers are always drained.
- **Cooldown Periods**: `CodeIndexerService` and `IndexOrchestratorService` now include intentional delays (500ms - 2s) during startup and resets to allow state to settle.
- **Graceful Termination**: `cleanupWorker` removes all listeners before calling `terminate()` to prevent "not connected" errors during process exit.

## Debugging
Check the electron terminal for `[CodeIndexerService]` and `[IndexOrchestrator]` tags. Exit code `4294930435`/`0xFFFFFF83` almost always indicates a native worker crash due to one of the above race conditions.