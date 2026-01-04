---
id: 10e5cc1e-fa12-4457-8976-afa07490ba18
title: Crash Investigation: Disabling File Watcher
tags: [crash-investigation, watcher, indexing, stability, chokidar]
files: [electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T06:18:38.676Z
updatedAt: 2026-01-04T06:18:38.676Z
---

# Crash Investigation: Disabling File Watcher

The file system watcher (Chokidar-based worker thread) has been explicitly disabled in `IndexOrchestratorService.ts` to isolate a recurring application crash during the startup/indexing phase.

## Context
After previous attempts to isolate the crash (disabling indexing workers, verifying startup checks), the application continued to exit with code `4294930435`. The next logical component to isolate is the file system watcher, which performs heavy directory traversal and event listening.

## Changes
- Modified `IndexOrchestratorService.ts`:
    - Updated `indexAll` to ensure `startWatching` remains commented out with an explicit "CRASH INVESTIGATION" label.
    - Updated `runStartupCheck` to ensure `startWatching` remains disabled even when indices are verified.

## Next Steps
1. Verify if the application remains stable after these changes.
2. If stability is achieved, audit the `watcher-worker.mjs` and Chokidar configuration for race conditions or resource exhaustion (e.g., watching `node_modules`).
3. If the crash persists, investigate LanceDB ANN index creation or IPC throughput limits.

## Related Files
- `electron/services/vector/IndexOrchestratorService.ts`
- `electron/workers/watcher/watcher-worker.js` (referenced)