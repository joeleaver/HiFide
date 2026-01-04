---
id: 8918175c-c23a-4c00-9dea-c923700f1ece
title: Indexing Maintenance System Design & Implementation
tags: [architecture, indexing, maintenance, rag]
files: [electron/services/vector/IndexOrchestratorService.ts, electron/services/WorkspaceService.ts, electron/services/index.ts]
createdAt: 2026-01-03T23:45:45.714Z
updatedAt: 2026-01-03T23:46:11.884Z
---

# Indexing Maintenance System

The indexing maintenance system ensures that Code, Knowledge Base (KB), and Memories are kept in sync semantically within the Vector Database.

## Architecture

### IndexOrchestratorService
Located at `electron/services/vector/IndexOrchestratorService.ts`, this service manages:
- **Full Scans**: Orchestrates `CodeIndexerService`, `KBIndexerService`, and `MemoriesIndexerService` to perform initial indexing of a workspace.
- **Incremental Updates**: Uses `chokidar` to watch the file system for changes.
- **Deletions**: Automatically prunes vectors from the database when files or KB articles are deleted.

## File System Watchers
The orchestrator watches the workspace root with specific ignores (`node_modules`, `.git`, `.hifide-private`, etc.).

### Routing:
- **.ts, .js, .go, .rs, .py**: Routed to `CodeIndexerService`.
- **.hifide-public/kb/*.md**: Routed to `KBIndexerService`.
- **.hifide-public/memories/*.json**: Routed to `MemoriesIndexerService`.

## Integration
The system is automatically initialized in `WorkspaceService.openFolder()`. When a user opens a folder, the `IndexOrchestratorService` starts a background indexing task and begins watching for changes.

## Manual Commands
- `indexAll(force: boolean)`: Forces a full re-index of the current workspace.