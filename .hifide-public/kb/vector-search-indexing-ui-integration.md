---
id: 5a7bf655-30c4-4510-b775-547da104151c
title: Vector Search Indexing UI Integration
tags: [indexing, ui, rpc, zustand, vector-search, status-bar]
files: [electron/backend/ws/handlers/indexing-handlers.ts, src/store/indexingStore.ts, src/components/StatusBar.tsx, electron/backend/ws/event-subscriptions.ts, electron/services/indexing/IndexOrchestrator.ts]
createdAt: 2026-01-04T19:04:48.072Z
updatedAt: 2026-01-04T19:04:48.072Z
---

# Vector Search Indexing UI Integration

## Overview
This document describes the UI integration for the Vector Search indexing system, including the StatusBar indicators and the Vector Search settings screen.

## Backend Components

### 1. Indexing Orchestrator RPC Handlers
**File:** `electron/backend/ws/handlers/indexing-handlers.ts`

Provides RPC methods for the IndexOrchestrator service:
- `indexing.getStatus` - Get current indexing status (queue length, indexed count, processing state)
- `indexing.start` - Start indexing for the current workspace
- `indexing.stop` - Stop indexing
- `indexing.reindex` - Re-index workspace (with optional force flag)

All methods are workspace-scoped and require an active workspace.

### 2. Event Broadcasting
**File:** `electron/backend/ws/event-subscriptions.ts`

Added subscription for `index-orchestrator-status` events that broadcast:
- `isProcessing` - Whether indexing is currently active
- `currentTask` - Description of current task (e.g., "Indexing...")
- `queueLength` - Number of files waiting to be processed
- `indexedCount` - Number of files successfully indexed

## Frontend Components

### 1. IndexingStore (Zustand)
**File:** `src/store/indexingStore.ts`

Zustand store that manages indexing UI state and RPC interactions:

**State:**
```typescript
interface IndexingStore {
  status: IndexingStatus | null
  error: string | null
  loading: boolean
}
```

**Actions:**
- `fetchStatus()` - Fetch current status from backend
- `subscribe()` - Subscribe to real-time status updates via WebSocket
- `startIndexing()` - Start indexing
- `stopIndexing()` - Stop indexing
- `reindex(force?: boolean)` - Re-index workspace

**Usage Pattern:**
```typescript
const status = useIndexingStore((s) => s.status)
const startIndexing = useIndexingStore((s) => s.startIndexing)

useEffect(() => {
  const unsubscribe = useIndexingStore.getState().subscribe()
  return () => unsubscribe()
}, [])
```

### 2. StatusBar Component
**File:** `src/components/StatusBar.tsx`

Enhanced with real-time indexing indicators:

**Features:**
- Shows indexing spinner and queue count when `isProcessing` is true
- Tooltip displays current task, queue length, and indexed count
- Maintains backward compatibility with vector counts display

**Visual Elements:**
- Spinner icon when indexing is active
- Queue count displayed next to database icon
- Hover tooltip with detailed status

### 3. Vector Settings Screen
**File:** `src/SettingsPane.tsx` (VectorSettingsSection component)

Already implemented via `vectorStore` with controls for:
- Re-index individual tables (code, kb, memories)
- Progress bars for each table
- Embedding model selection per table
- Last indexed timestamp

## Event Flow

```
IndexOrchestrator emits 'index-orchestrator-status' event
    ↓
EventSubscriptionManager broadcasts to workspace-scoped connections
    ↓
IndexingStore receives via 'indexing.status.changed' notification
    ↓
Components using IndexingStore update reactively
```

## RPC Communication

### Request/Response Example

**Get Status:**
```typescript
// Client
const res = await client.rpc('indexing.getStatus', {})
// Response
{
  ok: true,
  isProcessing: true,
  currentTask: "Indexing...",
  queueLength: 42,
  indexedCount: 128,
  fileCount: 200,
  chunkCount: 850,
  workspaceId: "/path/to/workspace"
}
```

**Start Indexing:**
```typescript
const res = await client.rpc('indexing.start', {})
// Response
{ ok: true }
```

## Workspace Scoping

All indexing operations are workspace-scoped:
- RPC handlers check for active workspace via `getConnectionWorkspaceId()`
- Events are only sent to connections bound to the relevant workspace
- UI state is per-workspace (managed by the subscription filtering)

## Related Files

- `electron/services/indexing/IndexOrchestrator.ts` - Core indexing service
- `electron/workers/indexing/v2-watcher-worker.ts` - File watcher with gitignore filtering
- `src/store/vectorStore.ts` - Vector search state management
- `electron/backend/ws/handlers/vector-handlers.ts` - Vector search RPC handlers