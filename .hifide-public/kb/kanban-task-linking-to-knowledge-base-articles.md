---
id: 3ee95c64-6035-451b-a68f-cabb15a04c28
title: Kanban task linking to Knowledge Base articles
tags: [kanban, knowledge-base, ui-routing]
files: [electron/store/types.ts, electron/store/utils/kanban.ts, electron/services/KanbanService.ts, src/store/kanbanUI.ts, src/components/KanbanView/KanbanView.tsx, src/store/knowledgeBase.ts, src/components/KnowledgeBaseView.tsx]
createdAt: 2025-12-15T03:06:41.228Z
updatedAt: 2025-12-15T03:06:41.228Z
---

## Summary
Kanban tasks can optionally link to a Knowledge Base article via a `kbArticleId` field. The field is persisted inside the board JSON (`.hifide-public/kanban/board.json`), exposed through the shared `KanbanTask` type (`electron/store/types.ts`), validated in `electron/store/utils/kanban.ts`, and managed by `KanbanService` during create/update operations.

## Data flow
1. **Data model** – `KanbanTask` gains an optional `kbArticleId` (string). Kanban persistence schemas/defaults set the field to `null` when unset.
2. **Service layer** – `KanbanService.kanbanCreateTask` and `.kanbanUpdateTask` accept/normalize `kbArticleId`, trimming empty values to `null` before persisting. Existing tasks without the field remain backward compatible because normalization fills `null`.
3. **Renderer stores** – `useKanbanUI` keeps `kbArticleId` in `TaskFormValues`, allowing the modal to edit it. `useKnowledgeBase` exposes an `activeItemId` selector/setter so other views can focus a KB entry programmatically.
4. **UI** – `KanbanView`'s `TaskModal` provides a searchable select populated from `useKnowledgeBase().itemsMap`, storing the selected article ID. Cards render a KB badge/link when `kbArticleId` is present. Clicking the link switches the main view to `knowledgeBase` and sets `activeItemId` so `KnowledgeBaseView` opens the matching article.
5. **KnowledgeBaseView** – the component reads `activeItemId` from the store (instead of a local `useState`) to determine which article is selected, so navigation initiated elsewhere updates the editor correctly.

## Files
- `electron/store/types.ts`
- `electron/store/utils/kanban.ts`
- `electron/services/KanbanService.ts`
- `src/store/kanbanUI.ts`
- `src/components/KanbanView/KanbanView.tsx`
- `src/store/knowledgeBase.ts`
- `src/components/KnowledgeBaseView.tsx`
