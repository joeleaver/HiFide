# Indexing System - Code Examples

## 1. PriorityIndexingQueue Usage

```typescript
// Create global queue
const queue = new PriorityIndexingQueue();

// Push items from workspace A (code)
queue.push('workspace-a', codeEvents, 'code');

// Push items from workspace A (KB - higher priority)
queue.push('workspace-a', kbEvents, 'kb');

// Push items from workspace B (memories - highest priority)
queue.push('workspace-b', memoryEvents, 'memories');

// Pop next item (will be from workspace B memories first)
const item = queue.pop(1)[0];
// { workspaceId: 'workspace-b', type: 'memories', ... }

// Get queue length for specific workspace
const wsQueueLen = queue.getWorkspaceQueueLength('workspace-a');
```

## 2. WorkspaceIndexingManager Usage

```typescript
// Create manager for workspace
const manager = new WorkspaceIndexingManager('workspace-a');

// Start watcher
await manager.startWatcher();

// Check for missing items
await manager.checkMissingItems();

// Run startup check
await manager.runStartupCheck();

// Get current state
const state = manager.getState();
console.log(`Code: ${state.code.indexed}/${state.code.total}`);

// Cleanup on workspace close
await manager.cleanup();
```

## 3. GlobalIndexingOrchestrator Usage

```typescript
// Initialize global orchestrator
const orchestrator = new GlobalIndexingOrchestrator();
await orchestrator.init();

// Register workspace when it opens
await orchestrator.registerWorkspace('workspace-a');

// Start indexing
await orchestrator.start('workspace-a');

// Get status
const status = orchestrator.getStatus('workspace-a');
console.log(`Status: ${status.status}`);

// Unregister when workspace closes
await orchestrator.unregisterWorkspace('workspace-a');
```

## 4. VectorService with Workspace ID

```typescript
// Before (broken - no workspace isolation)
await vectorService.upsertItems(items, 'code');

// After (fixed - workspace-isolated)
await vectorService.upsertItems('workspace-a', items, 'code');

// Delete items from specific workspace
await vectorService.deleteItems('workspace-a', 'code', filter);

// Get indexed files for workspace
const files = await vectorService.getIndexedFilePaths('workspace-a', 'code');

// Update status for workspace
vectorService.updateIndexingStatus('workspace-a', 'code', 50, 100);
```

## 5. RPC Handler Example

```typescript
// Before (broken - no workspace awareness)
addMethod('indexing.start', async () => {
  const orchestrator = getIndexOrchestratorService();
  await orchestrator.start(); // Which workspace?
});

// After (fixed - workspace-aware)
addMethod('indexing.start', async () => {
  const orchestrator = getIndexOrchestratorService();
  const workspaceId = await getConnectionWorkspaceId(connection);
  if (!workspaceId) {
    return { ok: false, error: 'no-active-workspace' };
  }
  await orchestrator.start(workspaceId);
  return { ok: true };
});
```

## 6. Priority Queue Behavior

```typescript
// Queue state after multiple pushes:
// Priority: Memories (3) > KB (2) > Code (1)

queue.push('ws-a', [codeEvent1], 'code');      // Priority 1
queue.push('ws-b', [memoryEvent1], 'memories'); // Priority 3
queue.push('ws-a', [kbEvent1], 'kb');          // Priority 2
queue.push('ws-b', [codeEvent2], 'code');      // Priority 1

// Pop order:
// 1. ws-b memory (priority 3)
// 2. ws-a kb (priority 2)
// 3. ws-a code (priority 1, earlier timestamp)
// 4. ws-b code (priority 1, later timestamp)
```

## 7. Workspace Isolation Example

```typescript
// Workspace A vectors go to workspace-a database
await vectorService.upsertItems('workspace-a', itemsA, 'code');
// Table: code_vectors_{hash-of-workspace-a}

// Workspace B vectors go to workspace-b database
await vectorService.upsertItems('workspace-b', itemsB, 'code');
// Table: code_vectors_{hash-of-workspace-b}

// Search only returns results from requested workspace
const results = await vectorService.search('workspace-a', query);
// Only returns vectors from workspace-a
```

## 8. Round-Robin Scheduling

```typescript
// GlobalIndexingOrchestrator maintains queue:
// [ws-a:code, ws-b:code, ws-a:kb, ws-b:memories]

// With 2 workers, scheduling:
// Worker 1: ws-a:code
// Worker 2: ws-b:code
// (both complete)
// Worker 1: ws-a:kb
// Worker 2: ws-b:memories

// Fair allocation - each workspace gets equal worker time
```

