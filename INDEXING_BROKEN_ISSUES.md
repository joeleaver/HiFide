# Indexing System - Broken Issues Analysis

## Issue 1: Non-Serializable State

**Location**: `electron/services/indexing/IndexOrchestrator.ts` lines 37-38

```typescript
queue: IndexingQueue;
watcher: WatcherService;
```

**Problem**: These Service instances are stored in the state object, which is supposed to be serializable for persistence. This breaks the Service base class pattern.

**Impact**: 
- State persistence fails silently
- State changes don't trigger proper onStateChange callbacks
- Memory leaks when workspaces switch

**Fix**: Move queue and watcher out of state into private instance variables per workspace.

---

## Issue 2: Global Worker Pool Starvation

**Location**: `electron/services/indexing/IndexOrchestrator.ts` lines 673-695

```typescript
while (this.globalActiveWorkers < this.maxWorkers && 
       (ws.queue as any).state.queue.length > 0) {
  // Process only from current workspace
}
```

**Problem**: Each workspace processes its own queue independently. If workspace A has 100 files and workspace B has 1 file, workspace B's file might wait indefinitely.

**Impact**:
- Unfair scheduling between workspaces
- One workspace can monopolize all workers
- Poor user experience with multiple workspaces

**Fix**: Implement global priority queue with round-robin workspace selection.

---

## Issue 3: Missing Prioritization

**Location**: `electron/services/indexing/IndexingQueue.ts` lines 26-64

```typescript
public push(events: IndexingEvent[], priority = 0) {
  // Only two priority levels: 0 (low) and 1 (high)
  // No distinction between code, KB, and memories
}
```

**Problem**: All items treated equally. KB and memories should be indexed before code.

**Impact**:
- User memories and KB articles delayed while code indexes
- Poor search experience during initial indexing
- Doesn't match user expectations

**Fix**: Implement 3-tier priority: Memories (3) > KB (2) > Code (1).

---

## Issue 4: Vector Database Isolation

**Location**: `electron/services/vector/VectorService.ts` lines 65-69

```typescript
private tableConfigs: Record<TableType, TableConfig> = {
  code: { tableName: 'code_vectors', modelName: 'default', dimensions: 0, enabled: true },
  kb: { tableName: 'kb_vectors', modelName: 'default', dimensions: 0, enabled: true },
  memories: { tableName: 'memory_vectors', modelName: 'default', dimensions: 0, enabled: true }
};
```

**Problem**: Table names are global. All workspaces share the same tables.

**Impact**:
- Vectors from different workspaces mixed together
- Search results contaminated with other workspaces' data
- Data corruption risk when switching workspaces

**Fix**: Include workspace hash in table names: `code_vectors_{workspaceHash}`.

---

## Issue 5: Watcher Cleanup

**Location**: `electron/services/indexing/IndexOrchestrator.ts` lines 551-565

```typescript
async stopAndCleanup(rootPath: string) {
  await ws.watcher.stop();
  ws.queue.clear();
  // Watchers are never removed from state
}
```

**Problem**: Watchers accumulate in state.workspaces but are never cleaned up.

**Impact**:
- Memory leaks when switching workspaces
- Stale watchers continue listening to file changes
- State grows unbounded

**Fix**: Remove workspace entry from state when workspace closes.

---

## Issue 6: No Workspace Lifecycle Management

**Location**: `electron/services/indexing/IndexOrchestrator.ts` (entire file)

**Problem**: No integration with WorkspaceManager. Doesn't know which workspaces are open.

**Impact**:
- Can't prevent indexing closed workspaces
- Can't clean up resources when workspace closes
- No coordination with window lifecycle

**Fix**: Integrate with WorkspaceManager to track open workspaces.

---

## Issue 7: Settings Not Reloaded Dynamically

**Location**: `electron/services/indexing/IndexOrchestrator.ts` lines 105-118

```typescript
private loadSettings(): void {
  // Called only in constructor and indexAll
  // Not called when settings change
}
```

**Problem**: Worker count changes don't take effect until next re-index.

**Impact**:
- User changes worker count but it doesn't apply
- Confusing UX

**Fix**: Listen to settings change events and reinitialize workers.

---

## Issue 8: Broken Workspace State Access

**Location**: `electron/services/indexing/IndexOrchestrator.ts` lines 63-90

```typescript
getWorkspaceState(rootPath: string): OrchestratorWorkspaceState {
  const normalized = path.resolve(rootPath);
  if (!this.state.workspaces[normalized]) {
    // Creates new workspace state on first access
    // But this happens lazily, not at workspace open time
  }
}
```

**Problem**: Workspace state created lazily on first access, not at workspace open time.

**Impact**:
- Race conditions between workspace open and first indexing call
- Inconsistent state initialization
- Hard to debug

**Fix**: Create workspace state explicitly when workspace opens.

