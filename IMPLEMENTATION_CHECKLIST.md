# Indexing System Redesign - Implementation Checklist

## Phase 1: New Core Services

### PriorityIndexingQueue
- [ ] Create `electron/services/indexing/PriorityIndexingQueue.ts`
- [ ] Implement priority levels: Memories (3) > KB (2) > Code (1)
- [ ] Implement deduplication per workspace+path
- [ ] Implement round-robin workspace selection
- [ ] Add getWorkspaceQueueLength() method
- [ ] Add clear(workspaceId) method
- [ ] Write unit tests

### WorkspaceIndexingManager
- [ ] Create `electron/services/indexing/WorkspaceIndexingManager.ts`
- [ ] Implement per-workspace state tracking
- [ ] Implement watcher lifecycle management
- [ ] Implement checkMissingItems() method
- [ ] Implement runStartupCheck() method
- [ ] Implement cleanup() method
- [ ] Add event emission for status changes
- [ ] Write unit tests

### GlobalIndexingOrchestrator
- [ ] Create `electron/services/indexing/GlobalIndexingOrchestrator.ts`
- [ ] Implement worker pool management
- [ ] Implement workspace registration/unregistration
- [ ] Implement round-robin scheduling
- [ ] Implement integration with WorkspaceManager
- [ ] Implement settings change listener
- [ ] Implement dynamic worker pool resizing
- [ ] Implement processQueue() with round-robin
- [ ] Write unit tests

## Phase 2: VectorService Refactoring

- [ ] Add workspaceId parameter to all public methods
- [ ] Implement workspace-specific database paths
- [ ] Update table names to include workspace hash
- [ ] Update upsertItems() signature
- [ ] Update deleteItems() signature
- [ ] Update getIndexedFilePaths() signature
- [ ] Update updateIndexingStatus() signature
- [ ] Update deferIndexCreation() signature
- [ ] Update finishDeferredIndexing() signature
- [ ] Ensure backward compatibility or migration path
- [ ] Write integration tests

## Phase 3: RPC Handler Updates

- [ ] Update `electron/backend/ws/handlers/indexing-handlers.ts`
- [ ] Update indexing.start handler
- [ ] Update indexing.stop handler
- [ ] Update indexing.reindex handler
- [ ] Update indexing.setEnabled handler
- [ ] Update indexing.getStatus handler
- [ ] Ensure workspace context propagation
- [ ] Write integration tests

## Phase 4: Service Registration

- [ ] Update `electron/services/index.ts`
- [ ] Register GlobalIndexingOrchestrator
- [ ] Deprecate old IndexOrchestrator
- [ ] Update getIndexOrchestratorService() getter
- [ ] Update service initialization order

## Phase 5: WorkspaceManager Integration

- [ ] Update `electron/core/workspaceManager.ts`
- [ ] Add indexing manager lifecycle hooks
- [ ] Call registerWorkspace() on workspace open
- [ ] Call unregisterWorkspace() on workspace close
- [ ] Ensure proper cleanup on workspace teardown

## Phase 6: Workspace Loader Integration

- [ ] Update `electron/backend/ws/workspace-loader.ts`
- [ ] Ensure indexing starts after workspace binding
- [ ] Ensure proper error handling

## Phase 7: Testing

- [ ] Write GlobalIndexingOrchestrator tests
- [ ] Write WorkspaceIndexingManager tests
- [ ] Write PriorityIndexingQueue tests
- [ ] Write multi-workspace integration tests
- [ ] Write worker pool management tests
- [ ] Write prioritization logic tests
- [ ] Write vector database isolation tests
- [ ] Write workspace cleanup tests

## Phase 8: Documentation & Cleanup

- [ ] Update architecture documentation
- [ ] Add inline code comments
- [ ] Deprecate old IndexOrchestrator
- [ ] Remove old code after verification
- [ ] Update type definitions
- [ ] Update RPC API documentation

## Validation Checklist

- [ ] Single workspace indexing works
- [ ] Multiple workspaces index independently
- [ ] Worker pool is shared fairly
- [ ] KB and memories prioritized over code
- [ ] Vectors isolated per workspace
- [ ] Workspace cleanup removes all resources
- [ ] Settings changes apply dynamically
- [ ] No memory leaks on workspace switch
- [ ] No stale watchers after cleanup
- [ ] Round-robin scheduling works
- [ ] Deduplication works per workspace
- [ ] Status events emit correctly
- [ ] RPC handlers work with new architecture

## Risk Mitigation

- [ ] Keep old IndexOrchestrator during transition
- [ ] Add feature flag for new architecture
- [ ] Comprehensive logging for debugging
- [ ] Graceful fallback if issues detected
- [ ] Backup vector databases before migration

