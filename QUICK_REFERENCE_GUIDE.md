# Quick Reference Guide - Indexing System Redesign

## Key Files

### New Services
- `electron/services/indexing/PriorityIndexingQueue.ts` - Global queue
- `electron/services/indexing/WorkspaceIndexingManager.ts` - Per-workspace manager
- `electron/services/indexing/GlobalIndexingOrchestrator.ts` - Main orchestrator

### Modified Files
- `electron/services/vector/VectorService.ts` - Workspace-specific tables
- `electron/services/index.ts` - Service registration
- `electron/core/workspaceManager.ts` - Lifecycle integration
- `electron/backend/ws/workspace-loader.ts` - Auto-start indexing

## How It Works

### Workspace Open
```
1. User opens workspace
2. WorkspaceManager.ensureEntry() called
3. GlobalIndexingOrchestrator.registerWorkspace() called
4. WorkspaceIndexingManager created
5. workspace-loader.loadWorkspace() called
6. GlobalIndexingOrchestrator.start() called
7. Indexing begins
```

### Workspace Close
```
1. User closes workspace
2. WorkspaceManager.teardownWorkspace() called
3. GlobalIndexingOrchestrator.unregisterWorkspace() called
4. WorkspaceIndexingManager cleaned up
5. Workers released
6. Vectors remain in .hifide-private/vectors
```

## Key Methods

### GlobalIndexingOrchestrator
- `registerWorkspace(workspaceId)` - Register workspace
- `unregisterWorkspace(workspaceId)` - Unregister workspace
- `start(workspaceId)` - Start indexing
- `stop(workspaceId)` - Stop indexing
- `indexAll(workspaceId)` - Force full reindex
- `setIndexingEnabled(enabled)` - Enable/disable indexing
- `getStatus()` - Get global status
- `getGlobalStatus()` - Get detailed status

### WorkspaceIndexingManager
- `getState()` - Get workspace state
- `updateState(updates)` - Update state
- `startWatcher()` - Start file watcher
- `stopWatcher()` - Stop file watcher
- `setIndexingEnabled(enabled)` - Enable/disable
- `cleanup()` - Clean up resources

### PriorityIndexingQueue
- `push(item)` - Add item to queue
- `pop()` - Get next item
- `peek()` - View next item
- `clear()` - Clear all items
- `clearWorkspace(workspaceId)` - Clear workspace items
- `getQueueLength()` - Get total queue length
- `getWorkspaceQueueLength(workspaceId)` - Get workspace queue length

## Vector Database

### Storage Location
```
<workspace-root>/.hifide-private/vectors/
```

### Table Names
```
code_vectors_<hash>      - Code snippets
kb_vectors_<hash>        - Knowledge base articles
memory_vectors_<hash>    - AI memories
```

### Isolation
- Each workspace has separate tables
- Table names include workspace hash
- Vectors never mix between workspaces

## Settings

### Indexing Settings
```typescript
settings.vector.indexingEnabled  // true/false
settings.vector.indexingWorkers  // 1-8
settings.vector.provider         // 'local' or 'openai'
settings.vector.model            // embedding model
```

## Logging

### Key Log Messages
```
[WorkspaceManager] Registered workspace with indexing orchestrator
[WorkspaceManager] Unregistered workspace from indexing orchestrator
[workspace-loader] Starting indexing for workspace
[GlobalIndexingOrchestrator] Workspace registered
[GlobalIndexingOrchestrator] Workspace unregistered
[WorkspaceIndexingManager] State updated
```

## Testing

### Unit Tests
- GlobalIndexingOrchestrator.test.ts
- WorkspaceIndexingManager.test.ts
- PriorityIndexingQueue.test.ts
- VectorService.test.ts

### Integration Tests
- multi-workspace-indexing.test.ts
- worker-pool.test.ts
- prioritization.test.ts
- workspace-lifecycle.test.ts

### Manual Tests
- Single workspace indexing
- Multi-workspace indexing
- Workspace close cleanup
- Indexing enabled/disabled
- Worker pool sharing
- Vector isolation

## Troubleshooting

### Indexing Not Starting
1. Check `indexingEnabled` setting
2. Check console logs for errors
3. Verify workspace path is valid
4. Check `.hifide-private` directory exists

### Memory Leaks
1. Check workspace cleanup logs
2. Verify workers are released
3. Check for event listener cleanup
4. Monitor memory usage

### Vector Issues
1. Check table names in `.hifide-private/vectors`
2. Verify workspace hash in table name
3. Check vector dimensions match
4. Verify no table corruption

## Performance Tips

1. Adjust worker count based on CPU cores
2. Disable indexing for large workspaces if needed
3. Monitor memory usage with multiple workspaces
4. Use vector search for fast lookups

## Deployment

1. Feature flag for gradual rollout
2. Monitor for issues
3. Keep old IndexOrchestrator as fallback
4. Gradual user rollout

---

**Last Updated**: January 6, 2026
**Status**: Phases 1-5 Complete
**Next**: Phase 6 Testing

