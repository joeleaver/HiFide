# Remaining Work Checklist

## Phase 4: WorkspaceManager Integration

### electron/core/workspaceManager.ts

- [ ] Import GlobalIndexingOrchestrator
  ```typescript
  import { getGlobalIndexingOrchestratorService } from '../services/index.js'
  ```

- [ ] Update `ensureEntry()` method
  - [ ] Add orchestrator.registerWorkspace() call
  - [ ] Add error handling

- [ ] Update `teardownWorkspace()` method
  - [ ] Add orchestrator.unregisterWorkspace() call
  - [ ] Add error handling

- [ ] Test workspace registration/unregistration

## Phase 5: Workspace Loader Integration

### electron/backend/ws/workspace-loader.ts

- [ ] Import GlobalIndexingOrchestrator
  ```typescript
  import { getGlobalIndexingOrchestratorService } from '../../../services/index.js'
  ```

- [ ] Update `doLoad()` function
  - [ ] Add orchestrator.start() call after workspace binding
  - [ ] Check indexingEnabled flag
  - [ ] Add error handling

- [ ] Test indexing starts on workspace load

## Phase 6: Testing

### Unit Tests

- [ ] Create `electron/__tests__/global-indexing-orchestrator.test.ts`
  - [ ] Test workspace registration
  - [ ] Test workspace unregistration
  - [ ] Test worker pool initialization
  - [ ] Test status tracking
  - [ ] Test start/stop/indexAll methods

- [ ] Create `electron/__tests__/workspace-indexing-manager.test.ts`
  - [ ] Test state management
  - [ ] Test watcher lifecycle
  - [ ] Test queue management
  - [ ] Test event emission

- [ ] Create `electron/__tests__/priority-indexing-queue.test.ts`
  - [ ] Test prioritization (memories > kb > code)
  - [ ] Test deduplication
  - [ ] Test round-robin selection
  - [ ] Test workspace isolation

### Integration Tests

- [ ] Create `electron/__tests__/indexing-integration.test.ts`
  - [ ] Test multi-workspace indexing
  - [ ] Test worker pool sharing
  - [ ] Test vector isolation
  - [ ] Test prioritization across workspaces

### Manual Testing

- [ ] Open single workspace, verify indexing works
- [ ] Open two workspaces, verify independent indexing
- [ ] Verify worker pool is shared fairly
- [ ] Verify vectors are isolated per workspace
- [ ] Verify KB/memories prioritized over code
- [ ] Verify workspace cleanup on close
- [ ] Verify settings changes apply dynamically

## Phase 7: Documentation & Cleanup

### Documentation

- [ ] Update `ARCHITECTURE.md` with new design
- [ ] Add inline code comments to new classes
- [ ] Create migration guide from old to new architecture
- [ ] Update RPC API documentation
- [ ] Update type definitions in `electron/types/`

### Code Cleanup

- [ ] Mark old IndexOrchestrator as deprecated
- [ ] Add deprecation warnings
- [ ] Create feature flag for old/new architecture
- [ ] Update all imports to use new services
- [ ] Remove old code after verification

### Verification

- [ ] Run full test suite
- [ ] Check for TypeScript errors
- [ ] Check for linting errors
- [ ] Verify no memory leaks
- [ ] Verify performance is acceptable

## Deployment

- [ ] Create feature flag in settings
- [ ] Default to new architecture
- [ ] Add rollback plan
- [ ] Monitor for issues
- [ ] Gradually roll out to users

## Estimated Time

- Phase 4: 1-2 days
- Phase 5: 1 day
- Phase 6: 3-4 days
- Phase 7: 1-2 days
- Deployment: 1 day

**Total**: ~1-2 weeks

## Success Criteria

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] Multi-workspace indexing works correctly
- [ ] Vectors are properly isolated
- [ ] Worker pool is shared fairly
- [ ] Prioritization works correctly
- [ ] No memory leaks
- [ ] Performance is acceptable
- [ ] Documentation is complete
- [ ] Old code is deprecated/removed

## Notes

- Keep old IndexOrchestrator during transition for safety
- Add comprehensive logging for debugging
- Test thoroughly before deploying
- Have rollback plan ready
- Monitor production for issues

