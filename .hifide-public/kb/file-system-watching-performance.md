---
id: ad8a8084-8ca3-42e6-8c0f-05e7b65fb9e3
title: File System Watching & Performance
tags: [performance, architecture, fs]
files: [electron/workers/watcher/watcher-worker.js, electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T01:13:57.947Z
updatedAt: 2026-01-04T01:13:57.947Z
---

## File System Watching Strategy

To maintain UI responsiveness in large projects, all file system watching (using `chokidar`) is offloaded to a dedicated Worker Thread.

### Architecture
1. **Main Process**: Initializes the `WatcherService` but does not run the watcher directly.
2. **Watcher Worker**: Runs `chokidar.watch()` on the workspace root.
3. **Communication**: The worker sends 'add', 'change', and 'unlink' events over the `MessagePort`.
4. **Filtering**: The worker handles initial ignores (e.g., `.git`, `node_modules`) to further reduce Main thread message noise.

### Benefits
- Prevents the Main process event loop from being flooded during recursive directory crawls.
- Decouples UI heartbeats from I/O event processing.
