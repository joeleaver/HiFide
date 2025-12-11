---
id: 42712e68-ee2d-4cc7-a70b-03750503c0e4
title: ExplorerView modularization plan
tags: [explorer, architecture, renderer]
files: [src/components/ExplorerView.tsx, src/components/ExplorerView.css]
createdAt: 2025-12-10T22:31:04.536Z
updatedAt: 2025-12-10T22:40:50.067Z
---

## Status
✅ ExplorerView split into dedicated components (Nov 2024).
- `ExplorerView.tsx` now focuses on layout/composition only.
- Sidebar panes live under `src/components/explorer/` (`WorkspaceSearchPane`, `OpenFilesPane`, `ExplorerTree`, `ExplorerContextMenu`).
- Store-driven selectors are consumed inside each pane to minimize rerenders and keep logic centralized in Zustand stores.

## Goals
- Decompose `src/components/ExplorerView.tsx` into targeted view components so each pane can evolve independently.
- Ensure renderer components stay “dumb” by leaning on the existing Zustand stores (`useExplorerStore`, `useEditorStore`, `useTerminalTabs`, `useWorkspaceSearchStore`).
- Unlock workspace-search implementation without growing a 1k-line component.

## Target layout
| Pane | Component | Responsibilities |
| --- | --- | --- |
| Explorer chrome | `ExplorerShell` | Flex layout, split-resize glue, keyboard scopes. |
| Open files list | `OpenFilesPane` | Routed through explorer store (extracted). |
| Explorer tree | `ExplorerTreePane` + `FileTreeRow` | Tree rendering + context menu hooks (extracted). |
| Search panel | `WorkspaceSearchPane` | Dedicated component; receives Zustand store selectors only. |
| Editor tabs area | `EditorTabsPane` | Renders tab strip + Markdown toggle (still in `ExplorerView`). |
| Editor body | `EditorContentPane` | Chooses Monaco vs. mdxeditor (still in `ExplorerView`). |
| Terminal dock | `TerminalDockPane` | Wraps existing TerminalPanel. |

## Refactor steps
1. **Extract workspace search pane** to `src/components/explorer/WorkspaceSearchPane.tsx`. Keep existing logic but replace inline hooks with props/selectors. ✅
2. **Create explorer-only modules** (`ExplorerTree.tsx`, `ExplorerContextMenu.tsx`, `OpenFilesPane.tsx`). ✅
3. **Keep ExplorerView dumb**: it now composes panes, manages resizers, and owns only layout + editor/terminal rendering. ✅
4. **Use targeted Zustand selectors** in each pane to avoid cross-rerenders, following the renderer-store refactor doc (`KB 895b5365-4109-49ed-9031-1f556ac45a8a`).
5. **Update imports/tests** to point to the new components and keep CSS colocated.

## Files
- `src/components/ExplorerView.tsx`
- `src/components/explorer/WorkspaceSearchPane.tsx`
- `src/components/explorer/OpenFilesPane.tsx`
- `src/components/explorer/ExplorerTree.tsx`
- `src/components/explorer/ExplorerContextMenu.tsx`
- `src/components/ExplorerView.css`
