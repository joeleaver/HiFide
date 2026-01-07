# Indexing System Audit - Executive Summary

## Current State: Critical Issues

### 1. **Not Workspace-Aware** ⚠️ CRITICAL
- Single global worker pool shared across workspaces
- One workspace can starve others (no round-robin)
- Queue is per-workspace but worker assignment is global
- No mechanism to prevent indexing closed workspaces

### 2. **Broken Architecture** ⚠️ CRITICAL
- `IndexOrchestrator` stores `queue` and `watcher` Service instances in state
- These are not serializable - causes state persistence issues
- `globalActiveWorkers` counter doesn't match actual usage
- Watchers created per-workspace but never properly cleaned up

### 3. **Missing Prioritization** ⚠️ HIGH
- No prioritization of KB and memories over code
- All items treated equally in queue
- No boost for user-edited files vs initial scan

### 4. **Vector Database Isolation** ⚠️ HIGH
- VectorService has workspace-specific state but table names are global
- No guarantee vectors go to correct workspace database
- Embedding service is global, not workspace-aware

### 5. **Worker Pool Issues** ⚠️ MEDIUM
- Workers are global but need to serve multiple workspaces
- No load balancing between workspaces
- Settings changes require full restart

## Proposed Solution

### New Architecture (3-tier)

```
GlobalIndexingOrchestrator (main process)
├── Worker Pool (global, sized by settings)
├── PriorityIndexingQueue (global, workspace-aware)
└── WorkspaceIndexingManager[] (per-workspace)
    ├── WatcherService
    ├── Local queue
    └── Status tracking
```

### Key Improvements

1. **Workspace Isolation**: Each workspace has dedicated manager
2. **Fair Scheduling**: Round-robin between open workspaces
3. **Prioritization**: Memories > KB > Code
4. **Proper Cleanup**: Automatic when workspace closes
5. **Vector Safety**: Workspace ID passed through entire pipeline

## Implementation Roadmap

### Phase 1: New Core Services
- PriorityIndexingQueue (global, workspace-aware)
- WorkspaceIndexingManager (per-workspace)
- GlobalIndexingOrchestrator (replaces current)

### Phase 2: VectorService Refactoring
- Workspace-specific database paths
- Workspace-isolated table names
- Update upsert/delete operations

### Phase 3: RPC Handler Updates
- Update indexing-handlers.ts
- Ensure workspace context propagation

### Phase 4: Integration & Testing
- WorkspaceManager integration
- Multi-workspace testing
- Worker pool testing
- Prioritization testing

## Files to Create/Modify

**New Files:**
- `electron/services/indexing/PriorityIndexingQueue.ts`
- `electron/services/indexing/WorkspaceIndexingManager.ts`
- `electron/services/indexing/GlobalIndexingOrchestrator.ts`

**Modified Files:**
- `electron/services/indexing/IndexOrchestrator.ts` (deprecate)
- `electron/services/vector/VectorService.ts`
- `electron/backend/ws/handlers/indexing-handlers.ts`
- `electron/services/index.ts`

**Tests:**
- `electron/__tests__/indexing-orchestrator.test.ts`
- `electron/__tests__/workspace-indexing-manager.test.ts`

