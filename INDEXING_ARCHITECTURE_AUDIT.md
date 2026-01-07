# Indexing System Architectural Audit & Redesign

## Current State Analysis

### Problems Identified

1. **Not Workspace-Aware**: IndexOrchestrator maintains a global worker pool but doesn't properly isolate workspaces
   - Single global `workers[]` array shared across all workspaces
   - Queue is per-workspace but worker assignment is global
   - No round-robin between workspaces - one workspace can starve others

2. **Broken Functionality**:
   - IndexOrchestrator stores `queue` and `watcher` in workspace state but they're Service instances (not serializable)
   - `globalActiveWorkers` counter doesn't match actual worker usage across workspaces
   - No mechanism to prevent indexing closed workspaces
   - Watchers are created per-workspace but never properly cleaned up

3. **Missing Prioritization**:
   - No prioritization of KB and memories over code
   - All items treated equally in queue
   - No way to boost priority for user-edited files

4. **Vector Database Issues**:
   - VectorService has workspace-specific state but table names are global
   - No guarantee vectors go to correct workspace database
   - Embedding service is global, not workspace-aware

5. **Worker Pool Management**:
   - Workers are global but need to serve multiple workspaces
   - No load balancing between workspaces
   - Settings changes require full restart

## Proposed Architecture

### Core Components

1. **GlobalIndexingOrchestrator** (Main Process)
   - Maintains single worker pool (size from settings)
   - Manages global priority queue across all workspaces
   - Implements round-robin scheduling between open workspaces
   - Tracks which workspaces are open (via WorkspaceManager)
   - Prevents indexing of closed workspaces

2. **WorkspaceIndexingManager** (Per-Workspace)
   - Manages workspace-specific queue
   - Tracks indexing state (code, kb, memories counts)
   - Communicates with GlobalOrchestrator
   - Handles file watcher for workspace
   - Ensures vectors go to correct database

3. **PriorityIndexingQueue** (Global)
   - Merges queues from all workspaces
   - Prioritizes: Memories > KB > Code
   - Within same priority: recent edits > initial scan
   - Tracks workspace origin of each item

4. **VectorService Refactoring**
   - Workspace-specific database paths
   - Table names include workspace hash
   - Proper isolation of vectors per workspace

### Data Flow

```
FileSystem Changes
    ↓
WatcherService (per-workspace)
    ↓
WorkspaceIndexingManager.queue
    ↓
GlobalIndexingOrchestrator.priorityQueue
    ↓
Worker Pool (global, round-robin)
    ↓
VectorService.upsert(workspaceId, tableType, vectors)
```

### Key Design Decisions

- **Worker Pool**: Global, sized by settings, shared across workspaces
- **Queuing**: Two-level (workspace-local + global priority)
- **Scheduling**: Round-robin between open workspaces
- **Isolation**: Workspace ID passed through entire pipeline
- **Cleanup**: Automatic when workspace closes (via WorkspaceManager)

## Implementation Plan

### Phase 1: Create New Core Services

1. **PriorityIndexingQueue** (`electron/services/indexing/PriorityIndexingQueue.ts`)
   - Global queue with workspace awareness
   - Priority levels: Memories (3) > KB (2) > Code (1)
   - Deduplication per workspace
   - Round-robin workspace selection

2. **WorkspaceIndexingManager** (`electron/services/indexing/WorkspaceIndexingManager.ts`)
   - Per-workspace state and queue
   - Watcher management
   - Status tracking (code, kb, memories)
   - Communication with GlobalOrchestrator

3. **GlobalIndexingOrchestrator** (`electron/services/indexing/GlobalIndexingOrchestrator.ts`)
   - Replaces current IndexOrchestrator
   - Global worker pool management
   - Round-robin scheduling
   - Workspace lifecycle management

### Phase 2: Refactor VectorService

- Add workspace-specific database paths
- Ensure table names are workspace-isolated
- Update upsert/delete operations to use workspace ID

### Phase 3: Update RPC Handlers

- Update indexing-handlers.ts to use new architecture
- Ensure workspace context is passed through

### Phase 4: Integration & Testing

- Update WorkspaceManager integration
- Test multi-workspace scenarios
- Test worker pool management
- Test prioritization logic

## Critical Issues to Fix

1. **Workspace Isolation**: Queue and watcher stored in state (not serializable)
2. **Worker Starvation**: One workspace can starve others
3. **No Prioritization**: All items treated equally
4. **Vector Database**: No guarantee vectors go to correct workspace
5. **Cleanup**: Watchers not properly cleaned up on workspace close

