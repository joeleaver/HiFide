# Workspace Architecture Analysis

## Executive Summary

**Status**: ⚠️ **Partially Multi-Window Ready** - The architecture has good bones but significant duplication and incomplete integration.

**Key Finding**: There are **THREE competing sources of truth** for workspace identity:
1. `useMainStore.getState().workspaceRoot` (global, single-window)
2. `meta.workspaceId` (flow-scoped, multi-window ready)
3. `process.env.HIFIDE_WORKSPACE_ROOT` (environment fallback)

## The Good News ✅

### 1. Flow Execution Chain is Workspace-Aware

The flow execution chain correctly passes `workspaceId` through all layers:

```
flowInit (store action)
  ↓ workspaceId: storeState.workspaceRoot
FlowScheduler constructor
  ↓ this.workspaceId = args.workspaceId
FlowAPI creation
  ↓ workspaceId: this.workspaceId
llm-service
  ↓ toolMeta: { requestId, workspaceId: flowAPI.workspaceId }
Tool execution
  ↓ run(input, meta) where meta.workspaceId is available
```

**This chain is solid and ready for multi-window.**

### 2. Session Management is Workspace-Scoped

Sessions are already stored per-workspace:

```typescript
// electron/store/slices/session.slice.ts
sessionsByWorkspace: Record<string, Session[]>
currentIdByWorkspace: Record<string, string | null>
```

Helper methods exist:
- `getSessionsFor({ workspaceId })`
- `setSessionsFor({ workspaceId, sessions })`
- `getCurrentIdFor({ workspaceId })`
- `setCurrentIdFor({ workspaceId, id })`

**This is multi-window ready.**

### 3. WebSocket Connection Binding Exists

The WS server has per-connection workspace binding:

```typescript
// electron/backend/ws/server.ts
setConnectionWorkspace(connection, workspaceId)
getConnectionWorkspaceId(connection)
broadcastWorkspaceNotification(workspaceId, event, data)
```

**This is multi-window ready.**

### 4. WorkspaceManager Skeleton Exists

```typescript
// electron/core/workspaceManager.ts
class WorkspaceManagerImpl {
  bindWindowToWorkspace(win: BrowserWindow, workspaceId: WorkspaceId)
  unbindWindow(win: BrowserWindow)
  getWorkspaceForWindow(win: BrowserWindow): WorkspaceId | undefined
}
```

**This is multi-window ready but NOT INTEGRATED.**

## The Problems ❌

### Problem 1: Global `workspaceRoot` is Single Source of Truth

The main store has a **single global** `workspaceRoot` field:

```typescript
// electron/store/slices/workspace.slice.ts
export interface WorkspaceSlice {
  workspaceRoot: string | null  // ❌ SINGLE VALUE
  // ...
}
```

This field is:
- Persisted to disk
- Synced to `process.env.HIFIDE_WORKSPACE_ROOT`
- Used as the default by most tools
- **Can only hold ONE workspace at a time**

**Impact**: When Window A opens `/project-a` and Window B opens `/project-b`, only the last-opened workspace is stored in `workspaceRoot`.

### Problem 2: Duplication of Workspace Resolution Logic

There are **at least 6 different patterns** for resolving workspace root:

**Pattern A** (most tools):
```typescript
const root = meta?.workspaceId || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
```

**Pattern B** (workspace tools):
```typescript
async function getWorkspaceRoot(workspaceId?: string): Promise<string> {
  if (workspaceId) return path.resolve(workspaceId)
  const root = useMainStore.getState().workspaceRoot
  if (root) return path.resolve(root)
  return path.resolve(process.env.HIFIDE_WORKSPACE_ROOT || process.cwd())
}
```

**Pattern C** (resolveWithinWorkspace):
```typescript
const envRoot = process.env.HIFIDE_WORKSPACE_ROOT
const storeRoot = useMainStore.getState().workspaceRoot
const root = path.resolve(envRoot || storeRoot || process.cwd())
```

**Pattern D** (getIndexer):
```typescript
const root = path.resolve(
  workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
)
```

**Pattern E** (getSessionsDir):
```typescript
const baseDir = path.resolve(
  workspaceRoot || useMainStore.getState().workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
)
```

**Pattern F** (workspace IPC):
```typescript
return useMainStore.getState().workspaceRoot || process.cwd()
```

**Impact**: Inconsistent fallback order, hard to maintain, easy to miss edge cases.

### Problem 3: `process.env.HIFIDE_WORKSPACE_ROOT` is Redundant

This environment variable is:
- Set when `workspaceRoot` changes
- Used as a fallback in many places
- **Completely redundant** with the store

**Why it exists**: Historical - probably predates the Zustand store.

**Impact**: Extra state to keep in sync, potential for desync bugs.

### Problem 4: WorkspaceManager Not Integrated

The `WorkspaceManager` skeleton exists but is **never used**:
- Not imported anywhere except its own file
- Window-to-workspace binding never happens
- Per-workspace services (indexers, watchers) not managed

**Impact**: Multi-window infrastructure exists but is dormant.

### Problem 5: Indexer/Watcher Management is Global

Indexers and watchers are managed globally, not per-workspace:

```typescript
// electron/core/state.ts
const indexers = new Map<string, Indexer>()  // ✅ Per-workspace map
const kbIndexers = new Map<string, Indexer>()  // ✅ Per-workspace map

// But accessed via global singleton pattern:
export async function getIndexer(workspaceRoot?: string): Promise<Indexer>
```

Watchers are started/stopped in `setWorkspaceRoot`:

```typescript
// electron/store/slices/workspace.slice.ts
setWorkspaceRoot(folder) {
  if (previous && previous !== folder) {
    stopKanbanWatcher(previous)
    stopKbWatcher(previous)
  }
  if (folder) {
    startKanbanWatcher(folder)
    startKbWatcher(folder)
  }
}
```

**Impact**: Only one workspace can have active watchers at a time.

## Recommendations

### Phase 1: Eliminate Duplication (Low Risk)

1. **Create single workspace resolution utility**:
```typescript
// electron/utils/workspace.ts
export function resolveWorkspaceRoot(hint?: string): string {
  if (hint) return path.resolve(hint)
  const { useMainStore } = require('../store')
  const root = useMainStore.getState().workspaceRoot
  if (root) return path.resolve(root)
  return path.resolve(process.cwd())
}
```

2. **Replace all 6 patterns** with this single utility

3. **Remove `process.env.HIFIDE_WORKSPACE_ROOT`** entirely
   - It's redundant and error-prone
   - Tools should use `meta.workspaceId` or store

### Phase 2: Integrate WorkspaceManager (Medium Risk)

1. **Use WorkspaceManager in window creation**:
```typescript
// electron/core/window.ts
export function createWindow(opts?: { workspaceId?: string }): BrowserWindow {
  const win = new BrowserWindow(...)
  if (opts?.workspaceId) {
    WorkspaceManager.bindWindowToWorkspace(win, opts.workspaceId)
  }
  return win
}
```

2. **Move indexer/watcher management to WorkspaceManager**:
```typescript
interface WorkspaceEntry {
  id: WorkspaceId
  windows: Set<number>
  indexer: Indexer
  kbIndexer: Indexer
  kanbanWatcher: FSWatcher
  kbWatcher: FSWatcher
}
```

3. **Keep watchers running for all open workspaces**

### Phase 3: True Multi-Window Support (High Risk)

1. **Replace global `workspaceRoot` with window-scoped state**:
```typescript
// Main store keeps track of which workspace each window is viewing
windowWorkspaces: Record<number, string>  // windowId -> workspaceId

// Current "active" workspace is the focused window's workspace
getCurrentWorkspace(): string | null {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  return focusedWindow ? this.windowWorkspaces[focusedWindow.id] : null
}
```

2. **Update all store actions to accept `workspaceId` parameter**

3. **Update renderer to track its own `windowId` and `workspaceId`**

## Current State: Single Source of Truth?

**Answer: NO** - There are three competing sources:

1. **`meta.workspaceId`** (flow-scoped, correct for multi-window)
2. **`useMainStore.getState().workspaceRoot`** (global, single-window)
3. **`process.env.HIFIDE_WORKSPACE_ROOT`** (environment, redundant)

**For true multi-window support**, we need:
- `meta.workspaceId` as the **primary** source (flow-scoped)
- `WorkspaceManager.getWorkspaceForWindow(win)` as the **secondary** source (window-scoped)
- Remove `process.env.HIFIDE_WORKSPACE_ROOT` entirely
- Keep `workspaceRoot` only for backward compatibility during migration

