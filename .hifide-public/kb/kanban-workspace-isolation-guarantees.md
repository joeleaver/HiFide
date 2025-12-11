---
id: 667c9e51-4c50-42ca-be1f-862b75cb14e6
title: Kanban workspace isolation guarantees
tags: [kanban, workspace, architecture, safety]
files: [electron/backend/ws/workspace-loader.ts, electron/services/KanbanService.ts, electron/store/utils/kanban.ts, electron/backend/ws/broadcast.ts, electron/core/state.ts, src/store/binding.ts, src/store/hydration.ts, src/components/KanbanView/KanbanView.tsx, src/store/kanban.ts]
createdAt: 2025-12-11T01:08:37.183Z
updatedAt: 2025-12-11T01:08:37.183Z
---

### Backend scoping
- Each window is bound to a workspace root via `loadWorkspace` (`electron/backend/ws/workspace-loader.ts`), which calls `workspaceService.openFolder()` with the absolute path.  The loader also notifies the renderer via `workspace.attached` and streams a workspace-specific snapshot.
- `KanbanService` (`electron/services/KanbanService.ts`) keeps per-workspace state in `state.workspaces` keyed by `path.resolve(workspaceId)`.  All CRUD helpers call `resolveWorkspaceRoot()` before persisting, so even if relative paths are supplied they normalize to the canonical absolute workspace root.
- Disk persistence lives under `<workspace>/.hifide-public/kanban/board.json` (`electron/store/utils/kanban.ts`).  Saves are serialized per workspace through `DebouncedKanbanSaver`, which tracks `activeSaves` by workspace root, preventing cross-workspace writes.
- WebSocket notifications use `broadcastWorkspaceNotification` (`electron/backend/ws/broadcast.ts`), which looks up the window→workspace mapping inside `WorkspaceService` and only sends `kanban.board.changed` to connections whose normalized workspace matches.  Filesystem watchers (`electron/core/state.ts`) are also keyed by workspace root, so file change reloads never leak between projects.

### Frontend scoping
- The renderer stores the bound workspace ID in `useBackendBinding` (`src/store/binding.ts`).  Hydration applies the snapshot’s `workspaceId`/`workspaceRoot` before Kanban data loads (`src/store/hydration.ts`).
- Every Kanban RPC (`src/components/KanbanView/KanbanView.tsx`, `src/store/kanban.ts`) passes the current workspaceId explicitly (e.g., `client.rpc('kanban.moveTask', { workspaceId, ... })`).  If the store has no workspace bound, hydration short-circuits (`hydrateBoard` logs and returns), so an unbound renderer cannot accidentally mutate another project’s board.

### Result
Opening multiple windows is safe: each window’s WebSocket connection is registered with its own windowId, mapped to its workspace root, and only receives snapshots/notifications for that root.  Because persistence, in-memory state, and notifications are all keyed by the normalized workspace path, a second project cannot overwrite another project’s `.hifide-public/kanban/board.json` unless both windows intentionally point at the same folder path.