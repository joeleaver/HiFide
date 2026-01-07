# Indexing System Audit - Findings Summary

## Overview

The indexing system was not designed for multi-workspace support. While it has per-workspace state tracking, the architecture has fundamental flaws that prevent proper workspace isolation and fair resource allocation.

## Critical Findings

### 1. Architecture Mismatch
**Severity**: CRITICAL

The current `IndexOrchestrator` tries to be both:
- A global worker pool manager
- A per-workspace state tracker

This creates conflicts:
- Global workers serve per-workspace queues
- One workspace can starve others
- No round-robin scheduling

**Solution**: Split into GlobalIndexingOrchestrator + WorkspaceIndexingManager

### 2. Non-Serializable State
**Severity**: CRITICAL

Service instances stored in state:
```typescript
queue: IndexingQueue;  // Service instance
watcher: WatcherService;  // Service instance
```

This breaks the Service base class pattern and causes:
- State persistence failures
- Memory leaks
- Inconsistent state

**Solution**: Move to private instance variables per workspace

### 3. Missing Prioritization
**Severity**: HIGH

All indexing items treated equally:
- Code files indexed before KB articles
- Memories delayed during initial scan
- User edits not prioritized

**Solution**: Implement 3-tier priority queue

### 4. Vector Database Contamination
**Severity**: HIGH

All workspaces share table names:
```typescript
code: { tableName: 'code_vectors', ... }
```

Results in:
- Vectors from different workspaces mixed
- Search results contaminated
- Data corruption risk

**Solution**: Workspace-specific table names with hash

### 5. Resource Leaks
**Severity**: MEDIUM

Watchers and queues accumulate:
- Workspace state never removed
- Watchers continue listening
- Memory grows unbounded

**Solution**: Explicit cleanup on workspace close

### 6. No Workspace Lifecycle Integration
**Severity**: MEDIUM

No connection to WorkspaceManager:
- Can't prevent indexing closed workspaces
- Can't coordinate cleanup
- No window lifecycle awareness

**Solution**: Integrate with WorkspaceManager

## Quantified Impact

### Performance
- **Worker Starvation**: One workspace can monopolize all workers
- **Memory Leaks**: ~50MB per workspace switch (estimated)
- **Inefficient Scheduling**: No round-robin between workspaces

### User Experience
- **Slow Search**: KB articles delayed during code indexing
- **Data Corruption**: Vectors mixed between workspaces
- **Confusing Behavior**: Settings changes don't apply dynamically

### Reliability
- **State Corruption**: Non-serializable state causes persistence failures
- **Resource Exhaustion**: Unbounded memory growth
- **Race Conditions**: Lazy workspace state initialization

## Recommended Action

**Implement the proposed 3-tier architecture:**

1. **GlobalIndexingOrchestrator**: Manages worker pool and global queue
2. **WorkspaceIndexingManager**: Per-workspace state and lifecycle
3. **PriorityIndexingQueue**: Global queue with workspace awareness

**Timeline**: 2-3 weeks for full implementation + testing

**Risk Level**: Medium (requires careful integration with existing code)

**Benefit**: 
- Fair resource allocation
- Proper workspace isolation
- Better user experience
- Improved reliability

## Next Steps

1. Review this audit with team
2. Approve proposed architecture
3. Begin Phase 1 implementation
4. Comprehensive testing at each phase
5. Gradual rollout with feature flag

