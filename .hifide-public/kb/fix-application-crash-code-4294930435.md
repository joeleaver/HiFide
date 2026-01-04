---
id: 9615323c-5e44-4a96-9b23-4d130fe905e9
title: Fix Application Crash Code 4294930435
tags: [crash, electron, worker-threads, indexing]
files: []
createdAt: 2026-01-04T03:44:40.609Z
updatedAt: 2026-01-04T03:44:40.609Z
---

# Application Crash (Exit Code 4294930435)

## Problem
The application crashes during the indexing or hydration phase with exit code `4294930435`.
Logs show:
`[58084:0103/204332.954:ERROR:crashpad_client_win.cc(868)] not connected`
`ERROR: The process "58084" not found.`

## Analysis
This error typically occurs in Electron when a worker thread or child process is initialized while the main process is in a high-contention state (like hydration) or when IPC pipes are prematurely closed/not fully established. `Crashpad` errors on Windows often point to pipe connection failures during process initialization.

## Solutions Applied
1. **Disabled `stdin` in Worker Threads**: By default, workers might try to connect to the parent's `stdin`. Setting `stdin: false` in `CodeIndexerService.ts` reduces unnecessary IPC surface area.
2. **Increased Startup Delay**: In `IndexOrchestratorService.ts`, the delay before starting the background indexing check was increased from 2 seconds to 5 seconds. This allows more time for the UI hydration and main process stabilization.
3. **Pipe Monitoring**: `CodeIndexerService` already unpipes stdout/stderr during reset; ensuring these are not used during normal operation further stabilizes the workers.

## Prevention
- Always initialize heavy worker tasks *after* the initial UI hydration is complete.
- Use `setImmediate` or `setTimeout` to yield the event loop between heavy IPC operations.
- Explicitly disable `stdin`, `stdout`, and `stderr` for workers unless absolutely required.