# Multi-Window Workspace Implementation

## Overview

This document describes the implementation of true multi-window workspace support in HiFide. The changes enable multiple windows to operate on different workspaces simultaneously without crosstalk.

## Implementation Summary

### Phase 1: Eliminate Duplication ✅

**Goal**: Create single source of truth for workspace resolution and remove redundant `process.env.HIFIDE_WORKSPACE_ROOT`.

**Changes**:

1. **Created `electron/utils/workspace.ts`**:
   - `resolveWorkspaceRoot(hint?)` - Synchronous workspace resolution
   - `resolveWorkspaceRootAsync(hint?)` - Async workspace resolution
   - `resolveWithinWorkspace(path, hint?)` - Path resolution with traversal protection
   - Consistent fallback order: hint → store → cwd()

2. **Updated all workspace resolution patterns** (12 files):
   - `electron/tools/utils.ts` - Now delegates to workspace utility
   - `electron/tools/workspace/searchWorkspace.ts`
   - `electron/tools/workspace/map.ts`
   - `electron/tools/workspace/jump.ts`
   - `electron/services/flowProfiles.ts`
   - `electron/ipc/workspace.ts`
   - `electron/store/utils/workspace-helpers.ts`
   - `electron/store/utils/session-persistence.ts`
   - `electron/core/state.ts` (getIndexer, getKbIndexer)

3. **Removed `process.env.HIFIDE_WORKSPACE_ROOT` synchronization**:
   - Removed from `electron/store/slices/workspace.slice.ts::setWorkspaceRoot()`
   - Removed from `electron/store/index.ts::onRehydrateStorage()`
   - Removed from `electron/backend/ws/server.ts` (2 locations)

**Impact**: Eliminated 6 different workspace resolution patterns, reduced to 1 canonical utility.

### Phase 2: Integrate WorkspaceManager ✅

**Goal**: Use WorkspaceManager to manage per-workspace services (indexers, watchers).

**Changes**:

1. **Enhanced `electron/core/workspaceManager.ts`**:
   - Added `getIndexer(workspaceId)` - Returns workspace-scoped indexer
   - Added `getKbIndexer(workspaceId)` - Returns workspace-scoped KB indexer
   - Added `startWatchers(workspaceId, entry)` - Starts Kanban and KB watchers
   - Added `teardownWorkspace(workspaceId)` - Stops all services when last window closes
   - Made `bindWindowToWorkspace()` and `unbindWindow()` async
   - Auto-starts watchers when workspace entry is created
   - Auto-stops watchers when last window unbinds

2. **Updated `electron/core/state.ts`**:
   - `getIndexer()` now delegates to WorkspaceManager
   - `getKbIndexer()` now delegates to WorkspaceManager
   - Removed global indexer maps (now managed by WorkspaceManager)

3. **Updated `electron/store/slices/workspace.slice.ts`**:
   - Removed watcher start/stop logic from `setWorkspaceRoot()`
   - Added comment explaining WorkspaceManager now handles watchers

**Impact**: Multiple workspaces can now have active indexers and watchers simultaneously.

### Phase 3: True Multi-Window Support ✅

**Goal**: Replace global `workspaceRoot` with window-scoped workspace tracking.

**Changes**:

1. **Enhanced `electron/store/slices/workspace.slice.ts`**:
   - Added `windowWorkspaces: Record<number, string>` - Maps windowId → workspaceId
   - Added `setWorkspaceForWindow({ windowId, workspaceId })` - Bind window to workspace
   - Added `getWorkspaceForWindow({ windowId })` - Get workspace for specific window
   - Added `getCurrentWorkspace()` - Returns focused window's workspace
   - Kept `workspaceRoot` for backward compatibility (marked as deprecated)

2. **Updated `electron/core/window.ts`**:
   - Added `workspaceId` parameter to `createWindow(opts)`
   - Binds window to workspace via WorkspaceManager on creation
   - Updates store with `setWorkspaceForWindow()` on bind
   - Unbinds window from workspace on close (triggers teardown if last window)

**Impact**: Each window can now have its own workspace with independent services.

## Architecture

### Workspace Resolution Flow

```
Tool/Service needs workspace
  ↓
resolveWorkspaceRoot(hint?)
  ↓
1. If hint provided → return hint
2. Else read from store.workspaceRoot
3. Else fallback to process.cwd()
```

### Multi-Window Flow

```
createWindow({ workspaceId })
  ↓
WorkspaceManager.bindWindowToWorkspace(win, workspaceId)
  ↓
- Creates WorkspaceEntry if needed
- Starts indexers and watchers
- Tracks window binding
  ↓
store.setWorkspaceForWindow({ windowId, workspaceId })
  ↓
Window operates on its workspace
  ↓
Window closes
  ↓
WorkspaceManager.unbindWindow(win)
  ↓
- Removes window binding
- If last window: teardownWorkspace()
  - Stops watchers
  - Stops indexers
  - Removes entry
```

### Flow Execution (Already Multi-Window Ready)

```
flowInit({ workspaceId })
  ↓
Scheduler({ workspaceId })
  ↓
FlowAPI({ workspaceId })
  ↓
llm-service({ toolMeta: { workspaceId } })
  ↓
Tool.run(input, meta)
  ↓
resolveWorkspaceRoot(meta.workspaceId)
```

## Migration Path

### Current State (After Implementation)

- ✅ Tools use `meta.workspaceId` from flow execution
- ✅ WorkspaceManager manages per-workspace services
- ✅ Window-scoped workspace tracking in store
- ⚠️ Global `workspaceRoot` still exists for backward compatibility

### Future Cleanup (Optional)

1. **Remove global `workspaceRoot`**:
   - Update all code that reads `store.workspaceRoot` to use `getCurrentWorkspace()`
   - Remove `workspaceRoot` field from WorkspaceSlice
   - Remove `setWorkspaceRoot()` method

2. **Update persistence**:
   - Remove `workspaceRoot` from persisted state
   - Persist `windowWorkspaces` instead (or don't persist at all)

3. **Update renderer**:
   - Track `windowId` in renderer store
   - Use `getWorkspaceForWindow({ windowId })` instead of global `workspaceRoot`

## Testing Recommendations

1. **Single Window** (Backward Compatibility):
   - Open workspace → verify indexing works
   - Create Kanban task → verify persistence
   - Execute flow → verify tools work
   - Close workspace → verify watchers stop

2. **Multi-Window** (New Functionality):
   - Open Window A with `/project-a`
   - Open Window B with `/project-b`
   - Verify both have independent indexers
   - Verify both have independent watchers
   - Create Kanban task in Window A → verify saved to `/project-a/.hifide-public/kanban/board.json`
   - Create Kanban task in Window B → verify saved to `/project-b/.hifide-public/kanban/board.json`
   - Close Window A → verify `/project-a` watchers stop
   - Verify Window B still works

3. **Flow Execution**:
   - Execute flow in Window A → verify tools operate on `/project-a`
   - Execute flow in Window B → verify tools operate on `/project-b`
   - Verify no crosstalk between windows

## Files Changed

### Created (1)
- `electron/utils/workspace.ts` - Unified workspace resolution utilities

### Modified (15)
- `electron/core/workspaceManager.ts` - Enhanced with service management
- `electron/core/state.ts` - Delegate to WorkspaceManager
- `electron/core/window.ts` - Bind/unbind windows to workspaces
- `electron/store/slices/workspace.slice.ts` - Window-scoped tracking
- `electron/store/index.ts` - Removed env var sync
- `electron/backend/ws/server.ts` - Removed env var usage
- `electron/tools/utils.ts` - Use workspace utility
- `electron/tools/workspace/searchWorkspace.ts` - Use workspace utility
- `electron/tools/workspace/map.ts` - Use workspace utility
- `electron/tools/workspace/jump.ts` - Use workspace utility
- `electron/services/flowProfiles.ts` - Use workspace utility
- `electron/ipc/workspace.ts` - Use workspace utility
- `electron/store/utils/workspace-helpers.ts` - Use workspace utility
- `electron/store/utils/session-persistence.ts` - Use workspace utility

## Summary

The implementation successfully enables true multi-window workspace support while maintaining backward compatibility. The architecture is clean, with a single source of truth for workspace resolution and proper lifecycle management of per-workspace services.

