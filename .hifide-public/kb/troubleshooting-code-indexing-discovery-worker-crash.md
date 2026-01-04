---
id: 71015ef5-7692-48f3-9ea6-d097ec6cad45
title: Troubleshooting: Code Indexing Discovery Worker Crash
tags: [electron, windows, crash, indexing, worker_threads]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T05:14:22.163Z
updatedAt: 2026-01-04T05:14:22.163Z
---

## Code Indexing Workers Crash (Windows/Electron 34)

### Issue
During the discovery or parsing phase of code indexing, the application may crash with the following error:
```
[48948:0103/221236.248:ERROR:crashpad_client_win.cc(868)] not connected
ERROR: The process "48948" not found.
ELIFECYCLE Command failed with exit code 4294930435.
```

### Cause
This crash is caused by initializing `node:worker_threads` with `ELECTRON_RUN_AS_NODE: '1'` in the environment on Windows within an Electron 34 context. Electron tries to attach its crash reporter or other native shims to the worker thread, but because it's running in "Node mode" while being spawned from an Electron process, certain internal pipes/handles (like Crashpad) are mismatched or disconnected, leading to a hard crash of the main process or the worker being killed by the OS.

### Solution
Remove `ELECTRON_RUN_AS_NODE` from the worker's environment variables. Electron 34's `Worker` implementation handles the transition to a Node-like environment correctly without this flag when spawned from the main process.

### Affected Files
- `electron/services/vector/CodeIndexerService.ts`
- Any service spawning `node:worker_threads` in the Electron main process.

### Verification
Ensure indexing starts and discovery completes without the "crashpad" error in the logs.