# Dead Code Cleanup Analysis

## Overview

This document tracks dead code and redundant code that can be removed after the Zustand removal migration.

## Status: IN PROGRESS

---

## 1. Zustand Store (electron/store/)

### Files Still Using useMainStore (35 files)

**Status:** Most are legitimate uses that need migration to services

**Files:**
1. `electron/services/agentPty.ts` - Uses for workspace root fallback
2. `electron/tools/astGrep.ts` - Uses for workspace root
3. `electron/app/context/contextBuilder.ts` - Uses for indexer
4. `electron/backend/ws/snapshot.ts` - Uses for workspace snapshot
5. `electron/core/state.ts` - Core state management (indexer, providers)
6. `electron/core/window.ts` - Window management
7. `electron/flow-engine/flow-api.ts` - Flow API
8. `electron/flow-engine/scheduler.ts` - Scheduler
9. `electron/ipc/edits.ts` - Edit operations
10. `electron/ipc/menu.ts` - Menu management
11. `electron/ipc/sessions.ts` - Session IPC
12. `electron/ipc/workspace.ts` - Workspace IPC
13. `electron/refactors/ts.ts` - TypeScript refactoring
14. `electron/store/index.ts` - Store definition (will keep)
15. `electron/store/slices/flowEditor.slice.ts` - Flow editor slice (will keep for renderer)
16. `electron/tools/code/searchAst.ts` - AST search
17. `electron/tools/code/searchWorkspace.ts` - Workspace search
18. `electron/tools/code/searchWorkspace.autorefresh.test.ts` - Test file
19. `electron/tools/kanban/*.ts` - Kanban tools (8 files)
20. `electron/tools/terminal/*.ts` - Terminal tools (5 files)
21. `electron/utils/workspace-session.ts` - Workspace session utils

### Slices Still in Use

**All slices are still being imported by `electron/store/index.ts`:**

1. ✅ `view.slice.ts` - Migrated to ViewService, but still used by store
2. ✅ `ui.slice.ts` - Migrated to UiService, but still used by store
3. ✅ `debug.slice.ts` - Migrated to DebugService, but still used by store
4. ✅ `planning.slice.ts` - Migrated to PlanningService, but still used by store
5. ✅ `app.slice.ts` - Migrated to AppService, but still used by store
6. ✅ `workspace.slice.ts` - Migrated to WorkspaceService, but still used by store
7. ✅ `explorer.slice.ts` - Migrated to ExplorerService, but still used by store
8. ✅ `indexing.slice.ts` - Migrated to IndexingService, but still used by store
9. ✅ `provider.slice.ts` - Migrated to ProviderService, but still used by store
10. ✅ `settings.slice.ts` - Migrated to SettingsService, but still used by store
11. ✅ `tools.slice.ts` - Migrated to ToolsService, but still used by store
12. ✅ `kanban.slice.ts` - Migrated to KanbanService, but still used by store
13. ❓ `terminal.slice.ts` - Type-only import, migrated to TerminalService
14. ✅ `session.slice.ts` - Migrated to SessionService, but still used by store
15. ✅ `flowEditor.slice.ts` - Partially migrated (3,021 lines), still used by store
16. ✅ `knowledgeBase.slice.ts` - NOT migrated yet, still used by store

**Decision:** Keep the store and slices for now since they're still being used by various parts of the codebase.

---

## 2. Potential Dead Code to Investigate

### A. Tools Using useMainStore

**Pattern:** Many tools use `useMainStore.getState().workspaceRoot` for workspace root

**Recommendation:** Replace with `WorkspaceService.getWorkspaceRoot()`

**Files to update:**
- `electron/tools/astGrep.ts`
- `electron/tools/code/searchAst.ts`
- `electron/tools/code/searchWorkspace.ts`
- `electron/tools/kanban/*.ts` (8 files)
- `electron/tools/terminal/*.ts` (5 files)

### B. IPC Handlers Using useMainStore

**Pattern:** IPC handlers use store for various operations

**Recommendation:** Migrate to service-based handlers (like we did for WebSocket)

**Files to update:**
- `electron/ipc/edits.ts`
- `electron/ipc/menu.ts`
- `electron/ipc/sessions.ts`
- `electron/ipc/workspace.ts`

### C. Core State Management

**File:** `electron/core/state.ts`

**Status:** Central state management file that manages indexers and providers

**Recommendation:** This is a core file that may need to stay as-is or be refactored into services

---

## 3. Next Steps

### Priority 1: Replace workspaceRoot References

**Goal:** Replace all `useMainStore.getState().workspaceRoot` with `WorkspaceService.getWorkspaceRoot()`

**Estimated effort:** 2-3 hours

**Files:** ~20 files

### Priority 2: Migrate IPC Handlers

**Goal:** Migrate IPC handlers to use services (like WebSocket handlers)

**Estimated effort:** 3-4 hours

**Files:** 4 main IPC files

### Priority 3: Evaluate Core State

**Goal:** Determine if `electron/core/state.ts` should be refactored

**Estimated effort:** 1-2 hours (analysis)

---

## 4. Files to Keep

**These files should NOT be deleted:**

1. `electron/store/index.ts` - Main store (still used)
2. `electron/store/slices/*.ts` - All slices (still used)
3. `electron/store/types.ts` - Type definitions (still used)
4. `electron/store/storage.ts` - Storage adapter (still used)
5. `electron/store/utils/*.ts` - Utility functions (still used)

**Reason:** The Zustand store is still being used by various parts of the codebase, and we decided to keep it for the renderer.


