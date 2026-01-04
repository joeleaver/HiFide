---
id: 0f56969e-b098-43dc-ae1c-a8362d6b46e3
title: Watcher Worker Status and Stability
tags: [indexing, workers, stability, watcher]
files: [electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T05:26:38.306Z
updatedAt: 2026-01-04T05:28:30.854Z
---

## Watcher Worker Status
The watcher worker has been re-enabled in `IndexOrchestratorService.ts`. It was previously disabled to isolate a 'not connected' Electron crash during the discovery phase.

## Current Configuration
- **Entry Point**: `electron/workers/watcher/watcher-worker.js` (bundled to `dist-electron/workers/watcher-worker.mjs`).
- **Function**: Watches the workspace root using `chokidar` (off-thread) and sends messages to the main thread on file changes.
- **Handling**: `IndexOrchestratorService` debounces these changes (2s) before enqueuing indexing jobs for Code, KB, or Memories.

## Stability Notes
- If the 'not connected' crash reappears, monitor the timing. The watcher is started after the full index queueing in `indexAll` and during the `runStartupCheck`.
- The watcher worker uses a fallback path resolution logic to find its `.mjs` bundle across different environments.