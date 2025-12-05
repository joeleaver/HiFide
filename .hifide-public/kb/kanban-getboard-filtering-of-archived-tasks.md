---
id: 48c5b5e8-1630-4479-817f-8b5d3637de77
title: Kanban getBoard filtering of archived tasks
tags: [kanban, tools, design]
files: [electron/tools/kanban/getBoard.ts, electron/tools/kanban/__tests__/getBoard.test.ts, jest.config.cjs]
createdAt: 2025-12-05T00:39:49.214Z
updatedAt: 2025-12-05T00:42:44.131Z
---

**Problem**
`kanbanGetBoard` returned every task in the board, including cards with `archived=true`, so LLM callers saw cluttered results.

**Solution**
- Treat the board returned by the tool as an "agent-safe" projection.
- Filter `board.tasks` down to only tasks where `archived !== true` before returning.
- Apply the same archived filter to the derived `tasks` array (which also honors status/epic filters) and the `byStatus` buckets/counts.
- Added helpers (`filterArchivedTasks`, `filterTasksByParams`, `groupTasksByStatus`) inside `electron/tools/kanban/getBoard.ts` to keep the logic testable.

**Regression Coverage**
- `electron/tools/kanban/__tests__/getBoard.test.ts` mocks `readKanbanBoard` and verifies:
  - Archived cards are absent from `board.tasks`, `tasks`, `byStatus`, and `counts`.
  - Additional filters (e.g., `status: 'done'`) still never surface archived cards.
- `jest.config.cjs` now maps the relative `../../store/utils/kanban.js` imports to the TypeScript source so the new tests run without relying on build artifacts.

**Related Files**
- `electron/tools/kanban/getBoard.ts`
- `electron/tools/kanban/__tests__/getBoard.test.ts`
- `jest.config.cjs`