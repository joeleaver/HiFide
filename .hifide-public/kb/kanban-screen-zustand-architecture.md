---
id: cafdeb5b-1c97-4178-b852-b79d65cb9135
title: Kanban screen Zustand architecture
tags: [kanban, zustand, frontend, architecture]
files: [src/store/kanban.ts, src/store/kanbanUI.ts, src/components/KanbanView/KanbanView.tsx]
createdAt: 2025-12-06T23:34:17.380Z
updatedAt: 2025-12-06T23:34:17.380Z
---

- `src/store/kanban.ts` holds the canonical board snapshot, async hydration logic, and derived helpers.  Board mutations must flow through `setBoard`, which also re-computes `tasksByStatus`/`epicMap` and drives `useKanbanHydration` from `idle` → `loading` → `ready`.  The store owns error notifications via `setError`, so UI components no longer watch for errors themselves.
- `src/store/kanbanUI.ts` centralizes all renderer-only state (modal visibility, form values, archive filters, archiving busy state).  Open/close helpers populate their respective forms, and close actions reset form state so React components can simply read selectors.
- `src/components/KanbanView/KanbanView.tsx` now only selects store state.  It never uses `useEffect`, `useMemo`, or `useState`; instead it consumes `tasksByStatus`, `epicMap`, and `useKanbanUI` actions for all interactions (task/epic modals, drawers, archive modal).  Form components (`TaskModal`, `EpicModal`, `ArchiveDoneModal`) call into the UI store directly for their field values and validations, keeping React components purely declarative.