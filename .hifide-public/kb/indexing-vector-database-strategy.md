---
id: 3c1b9df8-393b-433a-aaf5-cac7596956ab
title: Indexing & Vector Database Strategy
tags: [indexing, vector-db, architecture]
files: [electron/services/vector/IndexOrchestratorService.ts, electron/services/vector/CodeIndexerService.ts, electron/services/WorkspaceService.ts, electron/utils/fileDiscovery.ts]
createdAt: 2026-01-04T00:42:45.921Z
updatedAt: 2026-01-04T00:42:45.921Z
---

## Indexing Architecture

Indexing in HiFide is managed by the `IndexOrchestratorService`, which coordinates three primary indexers:
- `CodeIndexerService`: Uses native tree-sitter bindings to extract symbols (functions, classes) from source files.
- `KBIndexerService`: Indexes Markdown articles from `.hifide-public/kb`.
- `MemoriesIndexerService`: Indexes memories.

### Non-blocking Execution

To prevent the application from hanging or getting stuck in a loading state:

1. **Decoupled Load:** The `WorkspaceService.openFolder` method triggers indexing but does not `await` it.
2. **Startup Check:** `IndexOrchestratorService.runStartupCheck()` validates if indexes are missing or empty and triggers a background `indexAll(false)` if needed.
3. **Queue Processing:** Jobs are processed sequentially in a background queue using `setImmediate` and `setTimeout(100)` yields to ensure the Main Process stays responsive.
4. **Batch Yielding:** `CodeIndexerService` yields after every batch of 10 files.

### Configuration

- **Exclusions:** `DEFAULT_EXCLUDE_PATTERNS` in `electron/utils/fileDiscovery.ts` defines what is ignored (e.g., `node_modules`, `.git`, etc.).
- **Persistence:** Indexer state (hashes) is persisted to allow for efficient incremental indexing on subsequent startups.