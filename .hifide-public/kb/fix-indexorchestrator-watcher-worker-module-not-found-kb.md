---
id: ac61e563-4d68-4c2e-b8ab-935fff3e7a7a
title: Fix IndexOrchestrator Watcher Worker: Module Not Found (KB)
tags: [bugfix, electron, worker-threads, vite, bundling]
files: [vite.config.ts, electron/services/vector/IndexOrchestratorService.ts, electron/workers/watcher/watcher-worker.js]
createdAt: 2026-01-04T02:59:18.271Z
updatedAt: 2026-01-04T02:59:18.271Z
---

## Fix IndexOrchestrator Watcher Worker: Module Not Found

### Problem
The `IndexOrchestratorService` was attempting to load the `watcher-worker.js` from a hardcoded relative path in the `electron/workers/watcher/` directory. However, in the production/bundled environment, the `electron` source is compiled and bundled into the `dist-electron` folder. Since `watcher-worker.js` was not included in the Vite build entries, it was missing from the `dist-electron` output, leading to a `MODULE_NOT_FOUND` error.

### Solution
1. **Registered the worker in Vite config:** Added `watcher-worker` to the `build.lib.entry` in `vite.config.ts`. This ensures Vite processes the worker file and outputs `watcher-worker.mjs` into `dist-electron`.
2. **Updated Worker Path Resolution:** Modified `IndexOrchestratorService.ts` to look for `watcher-worker.mjs` in the same directory as the bundled service file (`__dirname`), following the pattern used for other workers in the project.

### Technical Details
- **Vite Entry:** `'watcher-worker': 'electron/workers/watcher/watcher-worker.js'`
- **Target Path:** `dist-electron/watcher-worker.mjs`
- **Resolution Logic:** `path.resolve(__dirname, 'watcher-worker.mjs')`

### Related Files
- `vite.config.ts`
- `electron/services/vector/IndexOrchestratorService.ts`
- `electron/workers/watcher/watcher-worker.js`