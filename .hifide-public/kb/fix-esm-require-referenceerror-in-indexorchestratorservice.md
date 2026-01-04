---
id: 77552802-6d40-4b54-a3a3-e279e8d346fe
title: Fix ESM require ReferenceError in IndexOrchestratorService
tags: [bugfix, esm, worker-threads, indexing]
files: [electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T02:58:19.913Z
updatedAt: 2026-01-04T02:58:19.913Z
---

Fixed a ReferenceError where `require` was called in an ESM context within `IndexOrchestratorService.startWatching`. 

### Resolution
- Replaced `require('node:worker_threads')` with `await import('node:worker_threads')`.
- Shimmed `__dirname` using `fileURLToPath(import.meta.url)` to ensure correct worker path resolution in the bundled ESM output.
- Updated `startWatching` to be `async` to support dynamic imports.

Associated files:
- `electron/services/vector/IndexOrchestratorService.ts`