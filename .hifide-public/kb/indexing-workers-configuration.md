---
id: 0fabf420-5fa6-4895-9cbc-1b4b0e82702e
title: Indexing Workers Configuration
tags: [indexing, settings, performance, workers, bug-fix, race-condition, watcher, events]
files: [electron/services/SettingsService.ts, electron/services/indexing/IndexOrchestrator.ts, electron/types/settings.ts, src/SettingsPane.tsx]
createdAt: 2026-01-04T20:11:26.186Z
updatedAt: 2026-01-04T20:21:54.589Z
---

## Bug Fix: Workers Not Processing Files

### Problem
After implementing dynamic worker reconfiguration, indexing workers were being created but not processing any files. The logs showed:
- Workers were successfully reconfigured (e.g., "Reconfiguring workers: 0 -> 8")
- Watcher discovered files and emitted events
- But no logs from workers actually processing files
- Files remained unindexed

### Root Cause
The watcher event handler (`this.watcher.on('events', ...)`) was only registered in the `init()` method. However, during re-index operations, the code called `reconfigureWorkers()` instead of `init()`, which:
1. Created new worker threads
2. Did NOT register the watcher event handler
3. Files were discovered by the watcher but the orchestrator never received the events
4. Workers had no work to process

### Solution
Refactored the initialization logic:

1. **Called `init()` instead of `reconfigureWorkers()`** in `indexAll()`
   - Ensures workers are created
   - Ensures watcher event handler is registered

2. **Made `init()` idempotent** with proper cleanup
   - Added code to terminate existing workers before creating new ones
   - Added `watcherHandlerRegistered` flag to prevent duplicate event listeners
   - Now `init()` can be called multiple times safely

3. **Removed `reconfigureWorkers()` method** (no longer needed)

### Code Changes
```typescript
// Before: indexAll() called reconfigureWorkers()
await this.reconfigureWorkers();

// After: indexAll() calls init()
await this.init();
```

### Result
- Workers now correctly receive file events from the watcher
- Files are processed and indexed as expected
- Dynamic worker count configuration works properly
- Settings changes (1, 2, 4, 8, 16 workers) take effect on re-index

### Related
- Original issue: Race condition in watcher 'ready' event
- Worker reconfiguration feature
- Settings integration for indexing workers

---

## Original Feature: Configurable Indexing Worker Count

This feature allows users to control the number of concurrent threads used for indexing via the settings UI.

### Implementation

#### Backend
- **SettingsService**: Added `indexingWorkers` field to vector settings with default of 4
- **IndexOrchestrator**: Reads `indexingWorkers` from settings on initialization
- **Type definitions**: Added to `SettingsSnapshot.vector` interface

#### Frontend
- **SettingsPane**: Added "Indexing Performance" section in Vector Settings
- **UI**: 5 preset buttons: 1, 2, 4, 8, or 16 workers
- **UX**: Setting disabled during active indexing to prevent conflicts

### Usage

Users can:
1. Navigate to Settings → Vector Search & Indexing
2. Find the "Indexing Performance" section
3. Choose worker count (1, 2, 4, 8, or 16)
4. Click "Re-index" to apply changes

### Performance Guidelines

- **1-2 workers**: Lower memory usage, slower indexing (resource-constrained systems)
- **4 workers**: Default, balanced performance (recommended for most systems)
- **8-16 workers**: Faster indexing on multi-core machines, higher memory usage

### Technical Details

- Worker count is persisted in Electron Store
- Changes take effect on next re-index operation
- Workers use Node.js worker_threads for parallel processing
- Settings can be changed multiple times without restart