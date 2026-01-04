---
id: a0799184-9eec-4323-afee-4971692dd0b9
title: Fix Native Crash: Discovery Worker I/O Saturation (Exit Code 4294930435)
tags: [crash, indexing, electron, worker-threads, io-saturation]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:01:51.839Z
updatedAt: 2026-01-04T03:40:25.258Z
---

## Exit Code 4294930435 / 0xFFFFFFFF Analysis

This error is a native crash (often a -1 or segmentation fault in the underlying Electron/Chromium process). It is frequently triggered by I/O saturation on the pipes connecting the Electron main process to its Worker Threads.

### Why Discovery Fails
The `discovery-worker.js` uses `globby` to scan the entire workspace. On large projects (or when `.gitignore` isn't properly honored), this generates a massive list of file paths. If the worker attempts to send progress messages or log large volumes of data to `stdout` or `stderr` before the IPC channel is ready or while it's being flooded, the native `crashpad_client` fails to connect a pipe, leading to an immediate crash of the thread.

### Solution Applied
1.  **Squelched Stdout/Stderr**: Modified `CodeIndexerService.ts` to silently drain `worker.stdout` and `worker.stderr` without string parsing or `console.log` calls. This eliminates any overhead or "backpressure" caused by main-thread logging.
2.  **Removed Verbose IPC**: Removed the `discovery-progress` message from `discovery-worker.js`. While well-intentioned, these messages compete with the massive `discovery-complete` payload and can trigger race conditions in the worker's message queue.
3.  **Filtered Exclusions**: Ensured binary and non-code formats (images, fonts, executables) are filtered out early in `DEFAULT_EXCLUDES` to reduce the payload size of the discovered file list.

### Verification
- Check for `indexedCount` updates in the UI.
- The logs should now show "Starting offloaded discovery" followed by "Discovered X files" without the intervening `crashpad` or `Autofill` error bursts.