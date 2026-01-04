---
id: cd784144-e772-4a9b-bd1a-8cca377bed43
title: File Watcher and Indexing Exclusions
tags: [watcher, fs, indexing, exclusions, architecture]
files: [electron/services/ExplorerService.ts, electron/workers/watcher/watcher-worker.js, electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T05:31:30.118Z
updatedAt: 2026-01-04T05:31:30.118Z
---

# File System Watcher & Indexer Exclusions

The system implements two primary file system watchers that monitor workspace changes:
1.  **Explorer Watcher**: Handles UI updates for the file explorer (`ExplorerService.ts`).
2.  **Indexing Watcher**: Handles background semantic indexing (`watcher-worker.js` via `IndexOrchestratorService.ts`).

## Core Exclusions (Hardcoded)
The following directories are ignored by default across both services:
- `node_modules`
- `.git`
- `.hifide-private` (Configuration & sensitive data)
- Build artifacts: `dist`, `build`, `out`, `.turbo`, `.next`
- Tool outputs: `coverage`, `.cache`

## Watcher-Specific Logic

### Explorer Watcher
- Uses `WATCHER_IGNORE_SEGMENTS` in `ExplorerService.ts`.
- Evaluates per path segment (e.g., if any part of the path is `node_modules`, it is ignored).
- **Does not currently respect `.gitignore` or `.hifide-public`**.

### Indexing Watcher
- Runs in a worker thread (`electron/workers/watcher/watcher-worker.js`).
- Explicitly ignores `**/.hifide-public/**` to prevent search results from leaking internal database/KB content, except where handled by specific indexers (e.g., KB indexer specifically watches its own subdirectory).
- **Does not currently respect `.gitignore`**.

## Known Issues & Improvements
1.  **GITIGNORE Support**: Neither watcher currently parses `.gitignore`. This can lead to excessive events in large repositories with many build artifacts not covered by the hardcoded segments.
2.  **Consistency**: `ExplorerService` and `watcher-worker` use slightly different exclusion lists and logic. These should be unified.
3.  **Recursive Search**: Searching for "watcher" reveals fragmented implementations in `GitStatusService` and `ExplorerService`.

## Current Exclusion Reference (ExplorerService)
```typescript
const WATCHER_IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.next',
  '.cache',
  '.hifide-private',
  'dist',
  'build',
  'coverage',
  'out',
])
```