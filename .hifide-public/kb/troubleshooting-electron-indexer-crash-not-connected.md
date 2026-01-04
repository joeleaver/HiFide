---
id: 84a7a415-daef-4e8b-b6c4-2b00979febef
title: Troubleshooting Electron Indexer Crash (not connected)
tags: [electron, windows, crash, indexing, worker-threads]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T05:53:37.079Z
updatedAt: 2026-01-04T05:58:02.661Z
---

## 'not connected' Electron Crash (Exit Code 4294930435)

This crash occurred during the Code Indexing discovery phase on Windows. The error `[40852:0103/225717.382:ERROR:crashpad_client_win.cc(868)] not connected` indicates a native crash in Electron's crashpad client, often triggered by rapid termination/startup of worker threads or saturated IPC pipes.

### Root Cause
1. **IPC Pipe Saturation**: Rapid discovery and message passing can saturate or abruptly close Windows named pipes used by Worker Threads.
2. **Crashpad Race Condition**: If a worker thread is terminated while it or the main process is under heavy I/O, the native crash handler may fail to connect to its listener pipe, resulting in a fatal process exit.
3. **Handle Deadlocks**: Stdout/Stderr streams not being explicitly drained or resumed during termination can leave open handles.

### Implemented Fixes
1. **Stream Draining**: Added `worker.stdout.resume()` and `worker.stderr.resume()` in `cleanupWorker` to ensure No remaining data blocks the worker's exit.
2. **Exit Cooldown**: Added a 500ms delay in the `exit` handler before final cleanup to allow native handles to settle.
3. **Initialization Safeguards**: Ensured `reset()` and `init()` have brief cooldowns to avoid rapid-fire restarts.
4. **TypeScript Fix**: Removed an invalid type cast `(err as any)` in `discovery-worker.js` that was inherited from a previous session and causing confusion.

### Files Modified
- `electron/services/vector/CodeIndexerService.ts`
- `electron/workers/indexing/discovery-worker.js`

### Verification
- Check Electron logs for "re-index requested" and "Discovery complete".
- Verify the process no longer terminates with code `4294930435` during discovery.