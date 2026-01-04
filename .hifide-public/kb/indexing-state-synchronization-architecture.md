---
id: 51b80c7d-59f1-4dbc-bb3d-beb0ffd5ea28
title: Indexing State Synchronization Architecture
tags: [indexing, state, synchronization, persistence, ui, architecture, watcher, workspace, vector-search, implementation]
files: [electron/services/indexing/IndexOrchestrator.ts, electron/services/WorkspaceService.ts, electron/services/vector/VectorService.ts, electron/services/SettingsService.ts, electron/backend/ws/handlers/indexing-handlers.ts, electron/backend/ws/event-subscriptions.ts, src/store/indexingStore.ts, src/components/SettingsPane.tsx, src/components/StatusBar.tsx]
createdAt: 2026-01-04T21:36:38.196Z
updatedAt: 2026-01-04T21:38:34.430Z
---

## Overview

The indexing state synchronization system ensures that the file watcher, indexer, and UI stay in perfect sync. The system:

1. **Always starts the file watcher on workspace startup** (regardless of whether indexing is enabled)
2. **Checks all items** (code files, KB articles, memories) against what's indexed
3. **Persists the user's indexing enabled/disabled preference** in settings
4. **Keeps the renderer state in sync** with detailed counts of total vs indexed items
5. **Starts indexing automatically** if the preference is enabled
6. **Updates both status bar and settings screen** with real-time indexing status

## Architecture

### Core Principle: File Watcher ≠ Indexer

The **file watcher** and the **indexer** are separate concerns:

- **File Watcher**: Always runs, detects all file system changes (adds, deletes, moves)
- **Indexer**: Processes files into vector embeddings, respects user's enable/disable preference

This separation ensures that changes are always detected, even when indexing is disabled.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Workspace Startup                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ├─► Initialize VectorService
                     │
                     ├─► Start WatcherService (ALWAYS)
                     │   ├─► Discovers all files
                     │   └─► Emits file system events
                     │
                     └─► Run Startup Check
                         ├─► Check indexingEnabled from Settings
                         ├─► Call checkMissingItems()
                         │   ├─► Code: total vs indexed
                         │   ├─► KB: total vs indexed
                         │   └─► Memories: total vs indexed
                         │
                         ├─► If enabled: Queue missing items and start indexing
                         └─► If disabled: Set status to idle, don't index
```

### State Management

#### OrchestratorState (Backend)

```typescript
interface OrchestratorState {
    status: 'idle' | 'indexing' | 'paused';
    processedCount: number;
    totalCount: number;
    totalFilesDiscovered: number;
    
    // Detailed counts for UI
    code: {
        total: number;      // Total files in workspace
        indexed: number;    // Files that have been indexed
        missing: number;     // Files that need indexing
    };
    kb: {
        total: number;      // Total KB articles
        indexed: number;    // Articles indexed
        missing: number;     // Articles needing indexing
    };
    memories: {
        total: number;      // Total memories
        indexed: number;    // Memories indexed
        missing: number;     // Memories needing indexing
    };
    
    indexingEnabled: boolean;  // User's preference from settings
}
```

#### IndexingStatus (Frontend)

```typescript
interface IndexingStatus {
    isProcessing: boolean;
    currentTask: string | null;
    queueLength: number;
    indexedCount: number;
    
    // Optional detailed counts
    code?: { total: number; indexed: number; missing: number };
    kb?: { total: number; indexed: number; missing: number };
    memories?: { total: number; indexed: number; missing: number };
    indexingEnabled?: boolean;
}
```

## Implementation Details

### 1. Settings Persistence

The `indexingEnabled` flag is stored in `SettingsService` at:

```typescript
settings.vector.indexingEnabled  // boolean, defaults to true
```

This is automatically persisted by the Service base class.

### 2. Workspace Startup Flow

**File: `electron/services/WorkspaceService.ts`**

```typescript
async openFolder(path: string, windowId: number) {
    // ... setup code ...
    
    if (orchestrator) {
        // ALWAYS start the file watcher (regardless of indexing state)
        console.log('[WorkspaceService] Starting file watcher for workspace...');
        orchestrator.startWatcher(path);
        
        // Run startup check: checks for missing items and starts indexing if enabled
        console.log('[WorkspaceService] Running startup check for indexing...');
        orchestrator.runStartupCheck(path);
    }
}
```

### 3. File Watcher Always Starts

**File: `electron/services/indexing/IndexOrchestrator.ts`**

```typescript
async startWatcher(rootPath: string): Promise<void> {
    this.rootPath = rootPath;
    if (this.workers.length === 0) await this.init();
    
    console.log('[IndexOrchestrator] Starting file watcher for:', rootPath);
    await this.watcher.start(rootPath, { ignoreInitial: false });
    
    // Wait for watcher to discover files
    const totalFiles = await watcherReadyPromise;
    this.setState({ totalFilesDiscovered: totalFiles });
}
```

### 4. Check Missing Items

**File: `electron/services/indexing/IndexOrchestrator.ts`**

```typescript
async checkMissingItems(rootPath: string): Promise<void> {
    const vectorService = getVectorService();
    
    // Check code files
    const codeIndexed = await vectorService.getIndexedFilePaths('code');
    const codeDiscovered = await this.discoverWorkspaceFiles(rootPath);
    const codeMissing = codeDiscovered.filter(path => !codeIndexed.has(path));
    
    this.setState({
        code: {
            total: codeDiscovered.length,
            indexed: codeIndexed.size,
            missing: codeMissing.length
        }
    });
    
    // Check KB articles and memories similarly...
}
```

### 5. Startup Check Logic

```typescript
async runStartupCheck(rootPath: string = '') {
    // Check for missing items and update counts
    await this.checkMissingItems(rootPath);
    
    // Check if indexing is enabled
    const indexingEnabled = this.state.indexingEnabled;
    
    if (!indexingEnabled) {
        console.log('[IndexOrchestrator] Indexing is disabled, skipping');
        this.setState({ status: 'idle' });
        return;
    }
    
    // Queue and index missing items
    const totalMissing = this.state.code.missing + this.state.kb.missing + this.state.memories.missing;
    
    if (totalMissing > 0) {
        console.log(`[IndexOrchestrator] Indexing ${totalMissing} missing items...`);
        // Queue missing files...
        this.setState({ status: 'indexing' });
        this.processQueue();
    } else {
        console.log('[IndexOrchestrator] All items already indexed.');
        this.setState({ status: 'idle' });
    }
    
    this.emitStatus();
}
```

### 6. Event Broadcasting

**File: `electron/services/indexing/IndexOrchestrator.ts`**

```typescript
private emitStatus() {
    this.emit('index-orchestrator-status', {
        isProcessing: this.isProcessing,
        currentTask: this.isProcessing ? 'Indexing...' : 'Idle',
        queueLength: this.queue.state.queue.length,
        indexedCount: this.indexedCount,
        // Detailed counts
        code: this.state.code,
        kb: this.state.kb,
        memories: this.state.memories,
        indexingEnabled: this.state.indexingEnabled
    });
}
```

**File: `electron/backend/ws/event-subscriptions.ts`**

```typescript
addWorkspaceSubscription(
    indexingOrchestratorService,
    'index-orchestrator-status',
    'indexing.status.changed',
    (data) => ({
        isProcessing: !!data.isProcessing,
        currentTask: data.currentTask || null,
        queueLength: typeof data.queueLength === 'number' ? data.queueLength : 0,
        indexedCount: typeof data.indexedCount === 'number' ? data.indexedCount : 0,
        // Detailed counts
        code: data.code || { total: 0, indexed: 0, missing: 0 },
        kb: data.kb || { total: 0, indexed: 0, missing: 0 },
        memories: data.memories || { total: 0, indexed: 0, missing: 0 },
        indexingEnabled: typeof data.indexingEnabled === 'boolean' ? data.indexingEnabled : true,
    })
)
```

## UI Components

### SettingsPane (src/SettingsPane.tsx)

Displays detailed indexing status in a new "Indexing Status" section:

```
┌────────────────────────────────────────────┐
│ Indexing Status                           │
│ ┌──────────────────────────────────────────┐ │
│ │ Overall Status              Enabled     │ │
│ │                                           │ │
│ │ Code                        42/50       │ │
│ │ 8 files pending indexing                │ │
│ │                                           │ │
│ │ Knowledge Base              15/20       │ │
│ │ 5 articles pending indexing             │ │
│ │                                           │ │
│ │ Memories                    8/8         │ │
│ │ 0 pending                                 │ │
│ │                                           │ │
│ │ Processing queue (12 items remaining)    │ │
│ └──────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### StatusBar (src/components/StatusBar.tsx)

Shows either:
- **During indexing**: Loader + count of files being indexed (e.g., "42/50")
- **When idle**: Static counts of total indexed vectors per type (code/kb/memories)

## Benefits

1. **Accurate UI**: Users always see the true state of indexing
2. **No Confusion**: Clear distinction between "indexing enabled" and "actually indexing"
3. **Transparent Progress**: Detailed counts show exactly what's indexed and what's pending
4. **Persistent Preferences**: User's choice to enable/disable indexing is respected
5. **Efficient Startup**: Only indexes missing items on startup (avoids re-indexing everything)
6. **Always Watching**: File watcher detects changes even when indexing is disabled

## Testing Checklist

- [ ] Enable indexing in settings
- [ ] Open a workspace → should see file watcher start
- [ ] Check SettingsPane → should show detailed counts
- [ ] Check StatusBar → should show indexing progress
- [ ] Stop indexing → should pause, but file watcher remains active
- [ ] Disable indexing → should stop all indexing, but watcher stays active
- [ ] Restart app → indexing preference should persist
- [ ] Add new file → should be detected and queued
- [ ] Delete indexed file → should be detected and removed from index
- [ ] Verify KB articles are counted correctly
- [ ] Verify memories are counted correctly

## Related Files

- `electron/services/indexing/IndexOrchestrator.ts` - Orchestrates indexing and emits status
- `electron/services/WorkspaceService.ts` - Starts watcher and runs startup checks
- `electron/services/vector/VectorService.ts` - Stores indexed items and provides query methods
- `electron/services/SettingsService.ts` - Persists indexingEnabled preference
- `electron/backend/ws/handlers/indexing-handlers.ts` - RPC handlers for indexing
- `electron/backend/ws/event-subscriptions.ts` - Maps events to WebSocket notifications
- `src/store/indexingStore.ts` - Renderer state for indexing status
- `src/components/SettingsPane.tsx` - Settings UI with detailed indexing status
- `src/components/StatusBar.tsx` - Status bar with indexing status display