---
id: 42712e68-ee2d-4cc7-a70b-03750503c0e4
title: ExplorerView modularization plan
tags: [explorer, architecture, renderer, ui]
files: [src/components/ExplorerView.tsx, src/components/ExplorerView.css, src/components/explorer/ExplorerTree.tsx]
createdAt: 2025-12-10T22:31:04.536Z
updatedAt: 2026-01-03T03:58:08.705Z
---

# ExplorerView modularization plan

The Explorer screen has been split into dedicated components (Nov 2024).

## Architecture
- `ExplorerView.tsx` now focuses on layout/composition only.
- Sidebar panes live under `src/components/explorer/`:
  - `OpenFilesPane.tsx`: Manages the list of currently open tabs.
  - `ExplorerTree.tsx`: The primary file system tree.
  - `WorkspaceSearchPane.tsx`: Advanced workspace-wide search results.
- Each pane uses Mantine's `ScrollArea` for internal scrolling.

## Layout Constraints
- The main sidebar container (`.explorer-sidebar-body`) uses `display: flex; flex-direction: column`.
- Sections within the sidebar must be constrained to allow internal scrollbars to function:
  - `ExplorerTree` must be wrapped in a flex container (`display: flex`) to ensure its `ScrollArea` correctly fills the available space.
  - `.explorer-sidebar-body` has `overflow-y: auto` as a fallback to prevent clipping when fixed-height sections (or headers/resizers) exceed the total height of the panel.

## Key Files
- `src/components/ExplorerView.tsx`
- `src/components/ExplorerView.css`
- `src/components/explorer/OpenFilesPane.tsx`
- `src/components/explorer/ExplorerTree.tsx`
- `src/components/explorer/WorkspaceSearchPane.tsx`
