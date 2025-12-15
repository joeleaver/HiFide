---
id: c8326c95-a394-4dfa-ab5c-d86efe20e2ca
title: Kanban tool schema support for KB-linked tasks
tags: [kanban, knowledge-base, tools]
files: [electron/tools/kanban/createTask.ts, electron/tools/kanban/updateTask.ts]
createdAt: 2025-12-15T15:09:50.398Z
updatedAt: 2025-12-15T15:09:50.398Z
---

### Summary
Kanban tasks now expose the `kbArticleId` link all the way through the agent-facing tool layer. Both `kanbanCreateTask` and `kanbanUpdateTask` accept the optional field, ensuring that automated agents can establish or change the Knowledge Base linkage without falling back to manual updates.

### Tool contract updates
- **`kanbanCreateTask`** (`electron/tools/kanban/createTask.ts`)
  - Description explicitly calls out the ability to link a Knowledge Base article when creating a task.
  - JSON schema adds an optional `kbArticleId` (string) property with a clear description.
  - The tool forwards `kbArticleId ?? null` to `KanbanService.kanbanCreateTask` so persistence stays consistent with the rest of the stack.
- **`kanbanUpdateTask`** (`electron/tools/kanban/updateTask.ts`)
  - Description highlights that the tool can manage the Knowledge Base association.
  - Parameters schema gained the optional `kbArticleId` string property.
  - Patch builder now propagates `kbArticleId ?? null` when provided before calling `kanbanUpdateTask` on the service.

These updates align the tool API with the recently introduced cross-linking UI, keeping automations and flows feature-complete with the manual experience.