---
id: afb456d9-2d43-4594-b14d-605a89b587d3
title: Kanban Service Handlers Workspace Context
tags: [kanban, websocket, workspace]
files: [electron/backend/ws/service-handlers.ts, electron/services/KanbanService.ts]
createdAt: 2025-12-07T00:04:25.504Z
updatedAt: 2025-12-07T00:04:25.504Z
---

When adding Kanban RPC helpers in `electron/backend/ws/service-handlers.ts`, every mutation call must include the workspace context before invoking `KanbanService`.

Implementation notes:
- Resolve the workspace identifier from the websocket connection via `getConnectionWorkspaceId(connection)`.
- Reject the request with `{ ok: false, error: 'No workspace bound to connection' }` when no workspace is associated.
- Pass the workspace ID through to `KanbanService` APIs:
  - `kanbanCreateTask` expects `workspaceId` inside the `input` payload.
  - `kanbanUpdateTask`, `kanbanDeleteTask`, and `kanbanMoveTask` require `workspaceId` arguments.
  - Epic mutations (`kanbanCreateEpic`, `kanbanUpdateEpic`, `kanbanDeleteEpic`) also require the workspace.
  - Archival (`kanbanArchiveTasks`) takes `{ olderThan, workspaceId }`.

This mirrors the classic handler implementations in `electron/backend/ws/handlers/kanban-handlers.ts` and prevents TypeScript errors such as TS2554/TS2345 that arise when workspaceId is omitted.