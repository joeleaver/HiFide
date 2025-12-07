---
id: 61b8b6d3-15ba-41c6-8e9a-2f95b949f1b9
title: kanbanGetBoard filtering rules
tags: [kanban, tools, kanbanGetBoard]
files: [electron/tools/kanban/getBoard.ts, electron/tools/kanban/__tests__/getBoard.test.ts]
createdAt: 2025-12-07T00:08:55.185Z
updatedAt: 2025-12-07T00:08:55.185Z
---

## Summary
`kanbanGetBoard` should only surface active work. The tool must filter out both archived cards and any tasks whose `status === "done"` before returning data to LLM callers.

## Implementation notes
- Apply filtering immediately after loading a workspace board via `readKanbanBoard(workspaceId)`. First drop archived tasks, then drop tasks with status `done`.
- All derived aggregates (`tasks`, `board.tasks`, `byStatus`, `counts`) operate on the filtered set, so consumers never see completed work even if they request `status: "done"`.
- Tests live in `electron/tools/kanban/__tests__/getBoard.test.ts` and should verify that done tasks are excluded regardless of filters.
