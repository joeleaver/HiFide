---
id: 14191969-6919-49da-aea9-a36caafdcd05
title: Discovery Worker Crash Analysis
tags: [troubleshooting, indexing, crash]
files: [electron/workers/indexing/discovery-worker.js, electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T05:41:01.687Z
updatedAt: 2026-01-04T05:41:01.687Z
---

## Troubleshooting: Discovery Worker Crash (Exit Code 4294930435)

### Symptoms
- Indexing hangs or crashes shortly after "Starting offloaded discovery".
- Console logs show: `[58768:0103/224017.297:ERROR:crashpad_client_win.cc(868)] not connected`.
- Exit code: `4294930435` (0xFFFFFFFB).
- Error messages about `ELIFECYCLE`.

### Known Causes
1. **OOM (Out of Memory):** `globby` and its underlying `fast-glob` can consume significant memory when indexing very large projects (multi-million file potential or deep trees).
2. **IPC Pipe Closure:** If the worker thread crashes or OOMs, the Electron main process might attempt to send/receive IPC messages to a defunct handle, leading to native `crashpad` errors.
3. **Infinite Recursion:** Deeply nested symbolic links (though `followSymbolicLinks: false` is used) or circular structures.

### Current Mitigation Strategy
- **Worker Isolation:** Using Node.js `worker_threads` to isolate discovery from the main thread.
- **Batched Processing:** Avoiding massive IPC payload transfers by keeping larger data structures within the worker.
- **Exclusion Lists:** Strict `DEFAULT_EXCLUDES` for heavy directories like `node_modules`, `.git`, and build folders.

### Planned Improvements
- Switch from `globby` to a streaming file walker (e.g., `walk-sync` or manual `fs.readdir` recursion) to reduce peak memory usage.
- Potentially use `vscode-ripgrep` for file discovery to leverage native performance and lower memory footprint.
