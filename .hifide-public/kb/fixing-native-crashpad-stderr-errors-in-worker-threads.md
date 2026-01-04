---
id: 4dca5939-5c68-4ca1-b085-3b1be31617b4
title: Fixing Native Crashpad Stderr Errors in Worker Threads
tags: [electron, worker-threads, crash, debugging]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:31:34.792Z
updatedAt: 2026-01-04T03:31:34.792Z
---

### Problem
A native Electron crash (Exit Code: 4294930435 / 0xFFFFFFFF) occurs when `worker_threads` are initialized or terminated rapidly, specifically involving Electron's internal `crashpad_client_win.cc` and stdio pipes. The error `not connected` suggests that the main process is trying to read from or write to a pipe that the worker thread has already closed during its termination sequence, or vice versa.

### Solution
In `CodeIndexerService.ts`:
1. **Draining Streams:** Ensure `stdout` and `stderr` are explicitly resumed and drained.
2. **Graceful Reset:** In the `reset()` method:
   - Unpipe and remove all listeners from `stdout` and `stderr` *before* calling `worker.terminate()`.
   - Use `Promise.all` combined with a timeout for terminations.
   - Introduce a 500ms cooldown after termination to allow the OS to reclaim file descriptors and pipes.
   - Explicitly suppress known noisy stderr messages like `crashpad_client_win.cc` and `not connected` even during the termination phase.
3. **Lazy Initialization:** Initialize workers only when needed and protect the initialization sequence with locks or flags to prevent rapid restart loops.

### Technical Details
- **Exit Code 4294930435:** This is often a signed/unsigned interpretation of -34 (EPIPE) or simply a general failure in a native child process.
- **worker_threads + stdio:** Node.js workers with `stdout: true` use internal pipes. If these aren't cleaned up before the thread is destroyed, native crashes in the host environment (Electron's Chromium bridge) can occur.