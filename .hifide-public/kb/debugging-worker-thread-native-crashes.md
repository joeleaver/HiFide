---
id: 541b8e64-33b1-4c86-b371-4caedd32b94c
title: Debugging Worker Thread Native Crashes
tags: [electron, worker-threads, bug-fix, native-crash]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:12:18.942Z
updatedAt: 2026-01-04T03:12:18.942Z
---

### Native Crashes in Worker Threads (`!flush_tasks_` / `crashpad_client_win.cc`)

**Problem:**
Native crashes (Exit code 4294930435 or similar) often occur when `node:worker_threads` are terminated abruptly while the main process is under heavy load or while the worker is still performing intensive I/O (like globby or file parsing). This is frequently indicated by logs like `!flush_tasks_` or `ERROR:crashpad_client_win.cc(868)] not connected`.

**Root Causes:**
1. **Pipe Saturation:** Excessive `stdout/stderr` data from worker threads can saturate the IPC pipes, causing the main process or worker to hang/crash.
2. **Race Condition on Termination:** Re-initializing workers immediately after calling `worker.terminate()` without waiting for the termination promise to resolve can leave the process in an unstable state.

**Solutions implemented in `CodeIndexerService.ts`:**
1. **Wait for Termination:** Always `await` the `worker.terminate()` promises in the `reset()` method.
2. **Remove Listeners:** Call `worker.removeAllListeners()` before termination to prevent handlers from firing on a dying worker.
3. **Safety Delay:** Add a small buffer (e.g., 200-500ms) after termination before spawning new workers.
4. **Pipe Drainage:** Explicitly consume `stdout/stderr` but skip logging internal crashpad or known "noisy" errors to avoid recursive IPC failures.
5. **Unref Workers:** Use `worker.unref()` if the workers are intended to be background tasks that shouldn't block process exit.

**Reference Task:** `task-6306a429-2ac4-4679-9ffe-63ec1a70e61f`