---
id: cf7b2c32-fe2a-4353-8bf9-5d3023e27ca5
title: Debugging Crashpad Client Win "not connected" Worker Crash
tags: [crash, electron, windows, worker-threads]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T06:13:33.773Z
updatedAt: 2026-01-04T06:13:33.773Z
---

The application was crashing with `[59288:0103/231230.060:ERROR:crashpad_client_win.cc(868)] not connected` immediately after initializing Node.js `worker_threads` for indexing discovery. This error typically occurs in Electron when a subprocess (even a standard Node worker thread initialized with `ELECTRON_RUN_AS_NODE` or similar environment triggers) attempts to connect to a Crashpad handler that is either missing or doesn't have the appropriate handles inherited.

Specifically on Windows, the crash was isolated to the creation of the `Discovery Worker` in `CodeIndexerService.ts`. Even with `stdout: false` and `stderr: false` (to prevent pipe saturation), the crash persisted.

### Resolution:
- Added `stdin: false` to the `Worker` constructor options in `CodeIndexerService.ts`.
- This prevents the worker from attempting to inherit the standard input stream from the main process, which can resolve "not connected" handle errors in Electron's hardened process environment on Windows.

### Reference:
- File: `electron/services/vector/CodeIndexerService.ts`
- Task: `Investigate and fix "crashpad_client_win.cc not connected" worker crash`