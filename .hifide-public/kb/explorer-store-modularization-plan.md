---
id: 14e7a9b6-6671-4fd3-b5e7-d828625f7b85
title: Explorer store modularization plan
tags: []
files: [src/store/explorer/base.ts, src/store/explorer/contextMenu.ts, src/store/explorer/selection.ts, src/store/explorer/sidebar.ts, src/store/explorer/treeSnapshot.ts, src/store/explorer/index.ts, src/store/explorer/store.ts, src/store/explorer/types.ts]
createdAt: 2025-12-10T22:56:46.819Z
updatedAt: 2025-12-10T23:41:37.883Z
---

## Goals
- Reduce `src/store/explorer.ts` size by splitting responsibilities into focused modules while keeping renderer components pure.
- Maintain centralized explorer persistence/side effects but isolate areas for selection, context menu, sidebar layout, and tree snapshots, enabling targeted tests.

## Target structure
1. **`src/store/explorer/base.ts`**
   - Core explorer state: workspace binding, directory maps, file metadata, persistence IO.
   - Low-level actions used by other slices (e.g., `refreshDir`, `setSidebarWidth`).
2. **`src/store/explorer/treeSnapshot.ts`**
   - Derived tree rows, normalization helpers, memoized selectors.
   - Export `buildTreeRows`, `selectTreeSnapshot`.
3. **`src/store/explorer/selection.ts`**
   - Multi-select logic (range selection, keyboard modifiers, clipboard metadata, drag source).
   - Exposes helper utilities consumed by `OpenFilesPane` / `ExplorerTree`.
4. **`src/store/explorer/contextMenu.ts`**
   - Menu visibility, anchor coordinates, action invocations (new file/folder, rename/delete, copy/cut/paste).
   - Uses renderer dialog store + explorer base actions.
5. **`src/store/explorer/sidebar.ts`**
   - Sidebar width, open-files pane height, workspace/search toggle state, persistence hydration.
6. **Shared types**
   - Move reusable interfaces (e.g., `ExplorerTreeRow`, `ExplorerClipboardEntry`) into `src/store/explorer/types.ts`.

## Implementation steps
1. Extract shared types + persistence helpers.
2. Split the existing Zustand store into multiple stores/slices, each in its file, re-exported via `src/store/explorer/index.ts`.
3. Update components to import from the new modules, using targeted selectors per concern.
4. Add unit tests for tree snapshot builder and selection utilities to prevent regressions.

## Notes
- No backend changes needed.
- Keep the public API stable to avoid large component rewrites; export shim functions for transitional usage.
- Document new modules in README/KB on completion.

## Implementation status (2025-01-09)
- `src/store/explorer/store.ts` now composes slices from `base.ts`, `selection.ts`, `contextMenu.ts`, `sidebar.ts`, and `treeSnapshot.ts`.
- Shared interfaces live in `src/store/explorer/types.ts`, with `index.ts` re-exporting store hooks and type aliases for components.
- `base.ts` owns hydration, directory IO, git/diagnostic aggregation, and defers clipboard/drag logic to the selection slice.
- `selection.ts` encapsulates range selection, clipboard TTL management, drag-and-drop, and exports helpers such as `collectSelectedRows`.
- `contextMenu.ts` maintains menu state plus all context actions, invoking dialogs/back-end RPCs while using selection helpers for clipboard + selection prep.
- `sidebar.ts` centralizes sidebar dimension persistence and exposes clamp utilities reused by other slices.
- `treeSnapshot.ts` is responsible for derived tree row generation and keeps selection/drop-target metadata in sync whenever the tree changes.