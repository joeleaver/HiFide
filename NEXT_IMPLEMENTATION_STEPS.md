# Next Implementation Steps

## Phase 4: WorkspaceManager Integration

### Objective
Connect the GlobalIndexingOrchestrator with WorkspaceManager so that:
- Workspaces are registered when opened
- Workspaces are unregistered when closed
- Indexing lifecycle is tied to workspace lifecycle

### File: `electron/core/workspaceManager.ts`

#### Changes Needed

1. **Import GlobalIndexingOrchestrator**
```typescript
import { getGlobalIndexingOrchestratorService } from '../services/index.js'
```

2. **In `ensureEntry()` method** (after workspace is created):
```typescript
private async ensureEntry(id: WorkspaceId): Promise<WorkspaceEntry> {
  const normalized = this.normalizeWorkspaceId(id)
  let entry = this.workspaces.get(normalized)
  if (!entry) {
    entry = { id: normalized, windows: new Set(), refCount: 0 }
    this.workspaces.set(normalized, entry)
    
    // NEW: Register with GlobalIndexingOrchestrator
    try {
      const orchestrator = getGlobalIndexingOrchestratorService()
      await orchestrator.registerWorkspace(normalized)
    } catch (err) {
      console.error(`[WorkspaceManager] Failed to register workspace with indexing orchestrator:`, err)
    }
    
    await this.startWatchers(normalized, entry)
  }
  return entry
}
```

3. **In `teardownWorkspace()` method** (when workspace closes):
```typescript
private async teardownWorkspace(id: WorkspaceId): Promise<void> {
  // NEW: Unregister from GlobalIndexingOrchestrator
  try {
    const orchestrator = getGlobalIndexingOrchestratorService()
    await orchestrator.unregisterWorkspace(id)
  } catch (err) {
    console.error(`[WorkspaceManager] Failed to unregister workspace from indexing orchestrator:`, err)
  }
  
  // Existing cleanup code...
  this.workspaces.delete(id)
}
```

## Phase 5: Workspace Loader Integration

### Objective
Ensure indexing starts properly when a workspace is loaded

### File: `electron/backend/ws/workspace-loader.ts`

#### Changes Needed

1. **After workspace binding** (in `doLoad` function):
```typescript
// After: await manager.bindWindowToWorkspace(win, workspaceId)

// NEW: Start indexing for the workspace
try {
  const orchestrator = getGlobalIndexingOrchestratorService()
  const manager = orchestrator.getWorkspaceManager(workspaceId)
  if (manager) {
    const state = manager.getState()
    if (state.indexingEnabled) {
      console.log('[workspace-loader] Starting indexing for workspace:', workspaceId)
      await orchestrator.start(workspaceId)
    }
  }
} catch (err) {
  console.error('[workspace-loader] Failed to start indexing:', err)
  // Don't fail workspace load if indexing fails
}
```

## Phase 6: Testing Strategy

### Unit Tests

1. **GlobalIndexingOrchestrator Tests**
   - Test workspace registration/unregistration
   - Test worker pool initialization
   - Test round-robin scheduling
   - Test status tracking

2. **WorkspaceIndexingManager Tests**
   - Test state management
   - Test watcher lifecycle
   - Test queue management
   - Test event emission

3. **PriorityIndexingQueue Tests**
   - Test prioritization logic
   - Test deduplication
   - Test round-robin selection
   - Test workspace isolation

### Integration Tests

1. **Multi-Workspace Scenarios**
   - Open 2 workspaces, verify independent indexing
   - Verify worker pool is shared fairly
   - Verify vectors are isolated per workspace

2. **Worker Pool Management**
   - Verify workers are reused across workspaces
   - Verify worker count respects settings
   - Verify workers are cleaned up on shutdown

3. **Prioritization Logic**
   - Verify memories indexed before KB
   - Verify KB indexed before code
   - Verify recent edits prioritized

4. **Vector Database Isolation**
   - Verify table names include workspace hash
   - Verify search only returns workspace-specific results
   - Verify deletion only affects workspace-specific data

## Phase 7: Documentation & Cleanup

### Documentation Updates

1. Update architecture documentation
2. Add inline code comments
3. Create migration guide for old IndexOrchestrator
4. Document new RPC API

### Code Cleanup

1. Deprecate old IndexOrchestrator
2. Remove old code after verification
3. Update type definitions
4. Update imports throughout codebase

## Estimated Timeline

- Phase 4: 1-2 days
- Phase 5: 1 day
- Phase 6: 3-4 days
- Phase 7: 1-2 days

**Total**: 1 week for remaining work

## Risk Mitigation

1. Keep old IndexOrchestrator during transition
2. Add feature flag to switch between old/new
3. Comprehensive logging for debugging
4. Graceful fallback if issues detected
5. Backup vector databases before migration

