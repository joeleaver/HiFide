---
id: e7343628-4b83-4bbb-a27c-dcbb7b47bee8
title: Kanban board feature plan
tags: [planning, kanban, roadmap]
files: [electron/store/utils/kanban.ts, electron/store/slices/kanban.slice.ts, electron/core/state.ts, electron/store/index.ts, electron/store/slices/workspace.slice.ts, src/store/index.ts, src/components/KanbanView/KanbanView.tsx, src/App.tsx, src/components/ActivityBar.tsx, electron/tools/kanban/getBoard.ts, electron/tools/kanban/createTask.ts, electron/tools/kanban/updateTask.ts, electron/tools/kanban/deleteTask.ts, electron/tools/kanban/moveTask.ts, electron/tools/kanban/createEpic.ts, electron/tools/kanban/updateEpic.ts, electron/tools/kanban/deleteEpic.ts, electron/tools/index.ts, .hifide-public/kanban/board.json]
createdAt: 2025-11-03T21:42:57.345Z
updatedAt: 2025-11-03T23:21:52.367Z
---

## Scope
- Adds a four-column Kanban view (Backlog, To Do, In Progress, Done) with tasks grouped under optional epics and markdown descriptions; persisted to `.hifide-public/kanban/board.json`.
- Introduces main-process store slice utilities (`electron/store/utils/kanban.ts`, `electron/store/slices/kanban.slice.ts`) for schema validation, CRUD, drag-and-drop reordering, and file watching via `startKanbanWatcher`/`stopKanbanWatcher`.
- Updates the shared store (`electron/store/index.ts`) and workspace slice to bootstrap the board and start watchers when the workspace root changes.
- Extends renderer state selectors and Activity Bar/App routing to surface a Mantine + @hello-pangea/dnd Kanban UI (`src/components/KanbanView/*`, `src/App.tsx`, `src/components/ActivityBar.tsx`).
- Registers Kanban agent tools (`electron/tools/kanban/*`, `electron/tools/index.ts`, `electron/store/slices/tools.slice.ts`) enabling board inspection and mutation from LLM flows.

## Data contract
```jsonc
{
  "version": 1,
  "columns": ["backlog", "todo", "inProgress", "done"],
  "epics": [{ "id": "epic-…", "name": "Foundations", "color": "#5C7AEA", "description": "…" }],
  "tasks": [{
    "id": "task-…",
    "title": "…",
    "status": "backlog" | "todo" | "inProgress" | "done",
    "order": 0,
    "epicId": "epic-…" | null,
    "description": "Markdown",
    "assignees": [],
    "tags": [],
    "createdAt": 0,
    "updatedAt": 0
  }],
  "metadata": { "createdAt": 0 }
}
```
- `KANBAN_STATUSES` keeps column ordering; persistence normalizes orders per status via `reindexOrders`.
- Watcher debounce reloads call `kanbanRefreshFromDisk` whenever `board.json` changes on disk.

## Renderer UX
- Drag-and-drop columns with optimistic persistence; Mantine modals handle create/edit/delete.
- Epic drawer supports CRUD with inline form and applies updates through store actions.
- Menu integration: `Cmd/Ctrl+3` opens Kanban; Activity Bar gains Kanban icon.

## Agent tooling
- `kanban:getBoard`, `kanban:createTask`, `kanban:updateTask`, `kanban:deleteTask`, `kanban:moveTask`, `kanban:createEpic`, `kanban:updateEpic`, `kanban:deleteEpic` validated with zod input schemas and mapped to workspace category for tool palette grouping.

## Open follow-ups
- Add unit/integration coverage (`electron/store/slices/__tests__/kanban.slice.test.ts`, `electron/tools/__tests__/kanban.tools.test.ts`) when test harness is ready.
- Consider richer metadata (due dates, attachments, assignees) and keyboard shortcuts/drag handles for accessibility.
