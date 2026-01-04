---
id: 3259a244-9519-4824-b75c-91e498f28d27
title: File Watcher Gitignore Filtering and Indexing Orchestrator
tags: [indexing, file-watcher, gitignore, chokidar, vector-search, rpc, zustand]
files: [electron/services/indexing/IndexOrchestrator.ts, electron/services/vector/VectorService.ts, src/SettingsPane.tsx]
createdAt: 2026-01-04T18:45:33.951Z
updatedAt: 2026-01-04T19:35:44.461Z
---

## Root Cause Analysis

The progress bar was disappearing because the VectorService's `activeTable` field was not being set when the IndexOrchestrator started indexing.

### The Bug

The VectorSettingsSection only shows the progress bar when:
```typescript
const isIndexingThisTable = (vectorStatus?.activeTable === tableKey || vectorStatus?.activeTable === 'all') && (hasRemainingWork || vectorStatus?.indexing)
```

This requires `activeTable` to be set to 'code', 'kb', 'memories', or 'all'.

The IndexOrchestrator was calling `VectorService.updateIndexingStatus()`, which sets:
- `sources.code = { indexed: 0, total: 156 }`
- `indexing = true`

But it was NOT calling `VectorService.startTableIndexing()`, which sets:
- `activeTable = 'code'`
- `indexing = true`
- `sources = {}` (reset)

Without `activeTable` set, the UI condition failed and the progress bar was hidden.

### The Fix

Modified `electron/services/indexing/IndexOrchestrator.ts` in the `indexAll()` method to call both:
```typescript
vectorService.startTableIndexing('code');  // Sets activeTable
vectorService.updateIndexingStatus('code', 0, totalFiles);  // Sets progress
```

### Complete Fix Chain

The full solution involved:
1. Waiting for watcher to be ready (to know total file count)
2. Calling `startTableIndexing('code')` to set `activeTable`
3. Calling `updateIndexingStatus()` to set progress
4. Removing duplicate `updateIndexingStatus` calls from ready event handler
5. Adding safety checks to ensure `totalFilesDiscovered > 0`

### Before vs After

| Phase | Before | After |
|--------|--------|-------|
| Start indexing | `activeTable` = null | `activeTable` = 'code' |
| Progress shown | ❌ No (condition fails) | ✅ Yes (condition passes) |
| UI behavior | Bar flickers then disappears | Bar shows and animates correctly |