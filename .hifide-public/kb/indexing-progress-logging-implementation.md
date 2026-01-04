---
id: 9b22f656-6f36-4b13-af3a-e903f9b49627
title: Indexing Progress Logging Implementation
tags: [indexing, logging, vite, workers]
files: [electron/workers/indexing/v2-watcher-worker.ts, electron/services/indexing/WatcherService.ts, electron/services/indexing/IndexOrchestrator.ts, vite.config.ts]
createdAt: 2026-01-04T18:19:40.427Z
updatedAt: 2026-01-04T18:19:40.427Z
---

## Overview
The indexing system now provides real-time feedback in the console during the re-indexing process.

## Changes
### Worker (`electron/workers/indexing/v2-watcher-worker.ts`)
- Tracks the number of files discovered during the initial scan.
- Sends a `log` message to the main thread every 10 files found.
- Sends a final summary log when the scan is complete.

### Service (`electron/services/indexing/WatcherService.ts`)
- Listens for `type: 'log'` messages from the worker.
- Prints log messages to the console with the `[WatcherService]` prefix.

### Orchestrator (`electron/services/indexing/IndexOrchestrator.ts`)
- Updated `indexAll` to use a new `startWithFullScan` method.
- This method forces the watcher to use `ignoreInitial: false`, which ensures that *all* existing files are reported as `add` events.
- This is crucial for generating logs during a "re-index" operation, which would otherwise be silent if `ignoreInitial` was `true` (default).

## Vite Configuration
To ensure worker files (`.ts`) are re-compiled during development (`pnpm run dev`), the `vite-plugin-node-worker` plugin was added to `vite.config.ts`.

### Example Logs
```text
[IndexOrchestrator] Initializing 4 parser workers...
[WatcherService] Starting worker from: ...
[WatcherService] Scanning... 10 files found
[WatcherService] Scanning... 20 files found
...
[WatcherService] Discovery complete. Total files: 4521
[IndexOrchestrator] Watcher ready
```
