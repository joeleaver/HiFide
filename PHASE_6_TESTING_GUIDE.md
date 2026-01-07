# Phase 6: Testing Guide

## Overview

Phase 6 involves comprehensive testing of the new indexing system across all scenarios.

## Unit Tests to Create

### 1. GlobalIndexingOrchestrator Tests
**File**: `electron/__tests__/services/GlobalIndexingOrchestrator.test.ts`

- [ ] Test initialization
- [ ] Test workspace registration
- [ ] Test workspace unregistration
- [ ] Test worker pool creation
- [ ] Test start/stop methods
- [ ] Test status tracking
- [ ] Test indexAll method
- [ ] Test setIndexingEnabled
- [ ] Test runStartupCheck

### 2. WorkspaceIndexingManager Tests
**File**: `electron/__tests__/services/WorkspaceIndexingManager.test.ts`

- [ ] Test state management
- [ ] Test getState method
- [ ] Test updateState method
- [ ] Test watcher lifecycle
- [ ] Test startWatcher/stopWatcher
- [ ] Test setIndexingEnabled
- [ ] Test event emission
- [ ] Test cleanup

### 3. PriorityIndexingQueue Tests
**File**: `electron/__tests__/services/PriorityIndexingQueue.test.ts`

- [ ] Test push/pop operations
- [ ] Test prioritization (memories > kb > code)
- [ ] Test deduplication per workspace
- [ ] Test round-robin workspace selection
- [ ] Test peek method
- [ ] Test clear method
- [ ] Test clearWorkspace method
- [ ] Test getQueueLength
- [ ] Test getWorkspaceQueueLength

### 4. VectorService Workspace Isolation Tests
**File**: `electron/__tests__/services/VectorService.test.ts`

- [ ] Test workspace-specific table names
- [ ] Test getTableName method
- [ ] Test getTableConfig method
- [ ] Test multiple workspaces have separate tables
- [ ] Test vector isolation per workspace
- [ ] Test search only returns workspace-specific results

## Integration Tests

### 1. Multi-Workspace Indexing
**File**: `electron/__tests__/integration/multi-workspace-indexing.test.ts`

- [ ] Open 2 workspaces
- [ ] Verify both index independently
- [ ] Verify worker pool is shared
- [ ] Verify vectors are isolated
- [ ] Close one workspace
- [ ] Verify other continues indexing
- [ ] Close second workspace
- [ ] Verify cleanup is complete

### 2. Worker Pool Management
**File**: `electron/__tests__/integration/worker-pool.test.ts`

- [ ] Test worker pool initialization
- [ ] Test worker reuse across workspaces
- [ ] Test worker count respects settings
- [ ] Test worker cleanup on shutdown
- [ ] Test worker error handling
- [ ] Test worker recovery

### 3. Prioritization Logic
**File**: `electron/__tests__/integration/prioritization.test.ts`

- [ ] Test memories indexed before KB
- [ ] Test KB indexed before code
- [ ] Test recent edits prioritized
- [ ] Test deduplication works
- [ ] Test round-robin scheduling

### 4. Workspace Lifecycle
**File**: `electron/__tests__/integration/workspace-lifecycle.test.ts`

- [ ] Test workspace registration on open
- [ ] Test workspace unregistration on close
- [ ] Test indexing starts on load
- [ ] Test indexing respects enabled flag
- [ ] Test cleanup on workspace close
- [ ] Test no resource leaks

## Manual Testing Scenarios

### Scenario 1: Single Workspace
1. Open HiFide
2. Open a workspace
3. Verify indexing starts automatically
4. Check console for registration logs
5. Verify vectors are created in `.hifide-private/vectors`
6. Close workspace
7. Verify cleanup logs appear

### Scenario 2: Multi-Workspace
1. Open HiFide
2. Open workspace A
3. Verify indexing starts
4. Open workspace B in new window
5. Verify both workspaces index independently
6. Check that vectors are isolated
7. Close workspace A
8. Verify workspace B continues indexing
9. Close workspace B
10. Verify all cleanup complete

### Scenario 3: Indexing Settings
1. Open workspace
2. Disable indexing in settings
3. Close and reopen workspace
4. Verify indexing does NOT start
5. Enable indexing
6. Verify indexing starts
7. Verify only missing files are indexed

### Scenario 4: Worker Pool
1. Open 3 workspaces
2. Monitor worker usage
3. Verify workers are shared fairly
4. Verify no worker starvation
5. Change worker count in settings
6. Verify pool resizes

### Scenario 5: Vector Isolation
1. Open workspace A
2. Index some files
3. Search for content
4. Open workspace B
5. Verify search results are workspace-specific
6. Add same files to workspace B
7. Verify separate vectors created
8. Verify searches are isolated

## Performance Testing

- [ ] Measure indexing speed (files/second)
- [ ] Measure memory usage with multiple workspaces
- [ ] Measure CPU usage during indexing
- [ ] Verify no memory leaks on workspace close
- [ ] Verify no resource leaks on app close

## Error Handling Testing

- [ ] Test with invalid workspace path
- [ ] Test with read-only workspace
- [ ] Test with missing .hifide-private
- [ ] Test with corrupted vector database
- [ ] Test with network errors
- [ ] Test with disk full errors

## Regression Testing

- [ ] Verify old indexing still works (if kept)
- [ ] Verify no breaking changes to RPC API
- [ ] Verify no breaking changes to UI
- [ ] Verify backward compatibility

## Test Execution

```bash
# Run all tests
npm test

# Run specific test file
npm test -- GlobalIndexingOrchestrator.test.ts

# Run with coverage
npm test -- --coverage

# Run integration tests only
npm test -- --testPathPattern=integration
```

## Success Criteria

- ✅ All unit tests pass
- ✅ All integration tests pass
- ✅ All manual scenarios work
- ✅ No memory leaks detected
- ✅ No performance regressions
- ✅ All error cases handled gracefully
- ✅ Code coverage > 80%

## Timeline

- Unit tests: 1-2 days
- Integration tests: 1 day
- Manual testing: 1 day
- Bug fixes: 1 day

**Total**: 3-4 days

