# Workspace Awareness Audit

## Executive Summary

**Critical Finding**: The Kanban persistence issue is a symptom of a deeper architectural problem. The application has **inconsistent workspace awareness** across different subsystems:

1. ✅ **Scheduler**: Receives `workspaceId` from `flowInit` and passes it to nodes via `FlowAPI.workspaceId`
2. ❌ **Tools**: Ignore `FlowAPI.workspaceId` and read from `useMainStore.getState().workspaceRoot` instead
3. ❌ **Kanban Slice**: Reads from `get().workspaceRoot` (which is the global store's `workspaceRoot`)
4. ⚠️ **Multi-Window Support**: Partially implemented but not fully integrated

## The Root Problem

When a flow executes, the scheduler correctly receives and tracks `workspaceId`:

```typescript
// electron/store/slices/flowEditor.slice.ts:929
const initArgs: any = {
  requestId,
  sessionId: currentSessionId,
  flowId: execFlowId,
  flowDef,
  initialContext: sessionContext2,
  workspaceId: storeState.workspaceRoot || undefined,  // ✅ Passed to scheduler
  // ...
}
```

The scheduler stores this and provides it to nodes via FlowAPI:

```typescript
// electron/ipc/flows-v2/scheduler.ts:729
return {
  nodeId,
  requestId: this.requestId,
  executionId,
  workspaceId: this.workspaceId,  // ✅ Available to nodes
  // ...
}
```

**BUT** tools completely ignore `FlowAPI.workspaceId` and read from the global store instead:

```typescript
// electron/tools/kanban/createTask.ts:21-22
const { useMainStore } = await import('../../store')
const state = useMainStore.getState() as any  // ❌ Reads global workspaceRoot

// electron/tools/workspace/searchWorkspace.ts:126-128
const { useMainStore } = await import('../../store/index')
const root = useMainStore.getState().workspaceRoot  // ❌ Reads global workspaceRoot
```

## Why This Breaks Multi-Window Support

The current architecture assumes a **single global workspace** stored in `useMainStore.getState().workspaceRoot`. This breaks when:

1. **Multiple windows are open** with different workspaces
2. **Window A** opens workspace `/project-a`
3. **Window B** opens workspace `/project-b`
4. Both windows share the same main store, so `workspaceRoot` can only hold ONE value
5. When Window A's flow executes Kanban tools, they read the global `workspaceRoot` which might be `/project-b`
6. **Result**: Window A's Kanban operations write to Window B's workspace

## Current Multi-Window Infrastructure

The codebase has **partial** multi-window support:

### ✅ What Exists

1. **WorkspaceManager skeleton** (`electron/core/workspaceManager.ts`):
   - Tracks multiple workspaces
   - Binds windows to workspaces
   - Reference counting for cleanup
   - **Status**: Skeleton only, not integrated

2. **Per-workspace session tracking** (`electron/store/slices/session.slice.ts`):
   ```typescript
   sessionsByWorkspace: Record<string, Session[]>
   currentIdByWorkspace: Record<string, string>
   ```

3. **WebSocket connection binding** (`electron/backend/ws/server.ts`):
   - Each connection can be bound to a workspace
   - `setConnectionWorkspace()` / `getConnectionWorkspaceId()`
   - Event filtering by workspace

4. **Renderer binding state** (`src/store/binding.ts`):
   ```typescript
   windowId: number | null
   workspaceId: string | null
   root: string | null
   attached: boolean
   ```

### ❌ What's Missing

1. **Tools don't use FlowAPI.workspaceId** - they read from global store
2. **Kanban slice reads from global workspaceRoot** - should be workspace-scoped
3. **Knowledge Base indexer** - not workspace-scoped
4. **Code indexer** - partially workspace-aware but uses global state
5. **No workspace-scoped service registry** - WorkspaceManager not integrated

## Immediate Fix for Kanban

The Kanban persistence error is happening because:

1. `workspaceRoot` in the main store is `null` (no workspace open, or wrong workspace)
2. Kanban tools call `kanbanCreateTask()` which calls `persistBoard()`
3. `persistBoard()` calls `resolveWorkspaceRoot(get)` which reads `get().workspaceRoot`
4. If `workspaceRoot` is `null`, it throws "Workspace root is not set"

**Short-term fix**: Make tools workspace-aware by reading from `FlowAPI.workspaceId`:

```typescript
// Instead of:
const { useMainStore } = await import('../../store')
const state = useMainStore.getState()
await state.kanbanCreateTask({ ... })

// Do:
async function run(input, flowAPI) {
  const workspaceId = flowAPI.workspaceId
  if (!workspaceId) throw new Error('No workspace bound')
  
  const { useMainStore } = await import('../../store')
  const state = useMainStore.getState()
  await state.kanbanCreateTask({ workspaceId, ... })
}
```

But this requires changing the Kanban slice to accept `workspaceId` as a parameter.

## Long-Term Architecture

To properly support multi-window/multi-workspace:

1. **Integrate WorkspaceManager**:
   - Make it the single source of truth for workspace → services mapping
   - Each workspace gets its own indexer, KB indexer, Kanban watcher, etc.

2. **Make tools workspace-aware**:
   - All tools receive `FlowAPI` which includes `workspaceId`
   - Tools use `workspaceId` to scope operations

3. **Scope store slices by workspace**:
   - Kanban: `kanbanBoardByWorkspace: Record<string, KanbanBoard>`
   - Sessions: Already done ✅
   - Explorer: Needs workspace scoping

4. **Remove global `workspaceRoot`**:
   - Replace with `activeWorkspaceByWindow: Record<number, string>`
   - Each window tracks its own workspace

5. **Event filtering**:
   - Already partially done via WebSocket connection binding
   - Ensure all events include `workspaceId` for filtering

## Recommendation

**Phase 1 (Immediate)**: Fix Kanban by making it workspace-aware
- Change Kanban slice methods to accept `workspaceId` parameter
- Update tools to pass `FlowAPI.workspaceId` to Kanban methods
- This unblocks LLM Kanban operations

**Phase 2 (Short-term)**: Make all tools workspace-aware
- Audit all tools and ensure they use `FlowAPI.workspaceId`
- Update tool signatures to require `FlowAPI` parameter

**Phase 3 (Long-term)**: Full multi-window support
- Integrate WorkspaceManager
- Scope all services by workspace
- Remove global `workspaceRoot`

