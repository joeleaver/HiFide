---
id: 9b0a3aba-e304-4ccc-b57d-f3e30e71e5c6
title: Electron 'not connected' Crash Mitigation
tags: [electron, workers, crash, debugging, stability, windows]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T05:23:30.143Z
updatedAt: 2026-01-04T06:01:26.207Z
---

## 'not connected' Electron Crash (crashpad_client_win.cc)

### Symptoms
Electron crashes with an exit code (e.g., 4294930435) or reports a `crashpad_client_win.cc(868): not connected` error shortly after logging `[CodeIndexerService] Starting workspace indexing`.

### Root Cause
On Windows, when `worker_threads` are created with `stdout: true` and `stderr: true`, Electron/Node.js attempts to pipe the child thread's output to the main process. If there is a high volume of output or if the process is under heavy I/O load (like during file discovery), the native pipe handling can fail, leading to a crash in Electron's `crashpad` client.

### Resolution
Disable `stdout` and `stderr` capturing for worker threads in production, or ensure that total output throughput is minimal.

In `CodeIndexerService.ts`:
```typescript
const worker = new Worker(workerPath, {
    workerData: { workerId },
    env: workerEnv,
    stdout: false, // Critical fix for Windows stability
    stderr: false
});
```

Instead of relying on `stdout/stderr` piping, use `parentPort.postMessage()` for structured logging and progress reporting.