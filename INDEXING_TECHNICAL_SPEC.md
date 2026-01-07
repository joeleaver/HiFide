# Indexing System - Technical Specification

## 1. PriorityIndexingQueue

**Location**: `electron/services/indexing/PriorityIndexingQueue.ts`

### Interface
```typescript
interface QueueItem {
  workspaceId: string;
  type: 'code' | 'kb' | 'memories';
  priority: number; // 3=memories, 2=kb, 1=code
  path: string;
  timestamp: number;
  event: IndexingEvent;
}

class PriorityIndexingQueue {
  push(workspaceId: string, events: IndexingEvent[], type: 'code' | 'kb' | 'memories'): void
  pop(count: number): QueueItem[]
  peek(): QueueItem | undefined
  clear(): void
  getQueueLength(): number
  getWorkspaceQueueLength(workspaceId: string): number
}
```

### Behavior
- Deduplicates per workspace+path
- Sorts by: priority (desc) → timestamp (asc)
- Tracks workspace origin of each item
- Supports clearing by workspace

## 2. WorkspaceIndexingManager

**Location**: `electron/services/indexing/WorkspaceIndexingManager.ts`

### Interface
```typescript
interface WorkspaceIndexingState {
  workspaceId: string;
  status: 'idle' | 'indexing' | 'paused';
  code: { total: number; indexed: number; missing: number; stale: number };
  kb: { total: number; indexed: number; missing: number; stale: number };
  memories: { total: number; indexed: number; missing: number; stale: number };
  indexingEnabled: boolean;
  totalFilesDiscovered: number;
  indexedCount: number;
}

class WorkspaceIndexingManager {
  constructor(workspaceId: string)
  getState(): WorkspaceIndexingState
  updateState(updates: Partial<WorkspaceIndexingState>): void
  startWatcher(): Promise<void>
  stopWatcher(): Promise<void>
  cleanup(): Promise<void>
  checkMissingItems(): Promise<void>
  runStartupCheck(): Promise<void>
}
```

### Responsibilities
- Manage per-workspace watcher
- Track indexing state
- Communicate with GlobalOrchestrator
- Handle workspace-specific cleanup

## 3. GlobalIndexingOrchestrator

**Location**: `electron/services/indexing/GlobalIndexingOrchestrator.ts`

### Interface
```typescript
class GlobalIndexingOrchestrator extends Service {
  // Worker pool management
  init(): Promise<void>
  terminate(): Promise<void>
  
  // Workspace management
  registerWorkspace(workspaceId: string): Promise<void>
  unregisterWorkspace(workspaceId: string): Promise<void>
  getOpenWorkspaces(): string[]
  
  // Indexing control
  start(workspaceId: string): Promise<void>
  stop(workspaceId: string): Promise<void>
  indexAll(workspaceId: string, force: boolean): Promise<void>
  
  // Status
  getStatus(workspaceId: string): WorkspaceIndexingState
  getGlobalStatus(): { activeWorkers: number; queueLength: number }
}
```

### Responsibilities
- Maintain global worker pool
- Manage PriorityIndexingQueue
- Implement round-robin scheduling
- Track open workspaces (via WorkspaceManager)
- Prevent indexing closed workspaces
- Emit status events

## 4. VectorService Refactoring

### Changes
- Add `workspaceId` parameter to all methods
- Workspace-specific database paths: `~/.hifide/vectors/{workspaceHash}`
- Table names: `code_vectors_{workspaceHash}`, etc.
- Ensure vectors upserted to correct database

### Methods to Update
- `upsertItems(workspaceId, items, tableType)`
- `deleteItems(workspaceId, tableType, filter)`
- `getIndexedFilePaths(workspaceId, tableType)`
- `updateIndexingStatus(workspaceId, tableType, indexed, total)`

## 5. RPC Handler Updates

### indexing-handlers.ts
- All handlers must get workspaceId from connection
- Pass workspaceId to GlobalOrchestrator methods
- Ensure workspace context propagation

### Key Handlers
- `indexing.start(workspaceId)`
- `indexing.stop(workspaceId)`
- `indexing.reindex(workspaceId, force)`
- `indexing.setEnabled(workspaceId, enabled)`
- `indexing.getStatus(workspaceId)`

