---
id: ce94b7ae-4a5a-414a-8d09-80d4dde01218
title: Editor implementation roadmap
tags: [editor, explorer, implementation, plan]
files: [src/store/editor.ts, src/store/utils/editorConflict.ts, src/store/__tests__/editorConflictPolicy.test.ts, src/store/__tests__/markdownCanonicalization.test.ts, src/store/explorer.ts, src/store/utils/editorSnapshot.ts, src/store/utils/editorPersistence.ts, src/store/utils/markdownCanonicalization.ts, src/store/utils/explorerPersistence.ts, src/store/dialogs.ts, src/components/ExplorerView.tsx, src/components/ExplorerView.css, src/components/RendererDialogs.tsx, electron/services/ExplorerService.ts, electron/backend/ws/handlers/ui-handlers.ts]
createdAt: 2025-12-08T22:58:10.119Z
updatedAt: 2025-12-10T22:54:29.239Z
---

---
id: ce94b7ae-4a5a-414a-8d09-80d4dde01218
title: Editor implementation roadmap
tags: [editor, explorer, implementation, plan]
files: [src/store/editor.ts, src/store/utils/editorConflict.ts, src/store/__tests__/editorConflictPolicy.test.ts, src/store/__tests__/markdownCanonicalization.test.ts, src/store/explorer.ts, src/store/utils/editorSnapshot.ts, src/store/utils/editorPersistence.ts, src/store/utils/markdownCanonicalization.ts, src/store/utils/explorerPersistence.ts, src/store/dialogs.ts, src/components/ExplorerView.tsx, src/components/ExplorerView.css, src/components/RendererDialogs.tsx, electron/services/ExplorerService.ts, electron/backend/ws/handlers/ui-handlers.ts]
createdAt: 2025-12-08T22:58:10.119Z
updatedAt: 2025-12-10T21:44:00.000Z
---

- **Open Files pane UX**: Entries now render as single-line filename rows (preview tabs italicized), rely on tooltips for paths, and persist both sidebar width + pane height via `explorerPersistence`. (Dec 2025)
- **Workspace/Search sidebar toggle** *(new)*: The explorer sidebar header has a `SegmentedControl` that flips between Workspace mode (Open Files pane + tree, with resize handles) and Search mode (full-height `WorkspaceSearchPane`). The selection persists per workspace via the new `sidebarMode` field inside `explorerPersistence`, so reopening a project restores whichever surface the user was using. (Dec 2025)
- **Explorer context menu & file operations**: Added VSCode-style context menus to tree rows and blank canvas, renderer-owned clipboard/context state in `useExplorerStore`, OS prompts for rename/create/delete, and RPC-backed filesystem actions (`explorer.createEntry`, `renameEntry`, `duplicateEntry`, `deleteEntry`, `pasteEntries`) wired through `ExplorerService` and `ui-handlers`. Styling + placement live in `ExplorerView.tsx/.css`. (Dec 2025)
- **Context menu polish & cut feedback**: Copy/cut actions now close the menu immediately, renderer clipboard state auto-expires after 60s (`setExplorerClipboard`), and cut targets are dimmed/italicized via `data-cut` attributes + CSS so users see pending moves until they paste or the clipboard resets. (Dec 2025)
- **Renderer dialog host**: Explorer actions now use `useDialogStore` + `RendererDialogs` for prompt/confirm flows, replacing blocked `window.prompt/confirm` usage so New/Rename/Delete modals work in Chromium sandboxed builds. (Dec 2025)
- **Explorer multi-select & drag move**: `useExplorerStore` now owns selection snapshots (`selectedRowIds`, anchor tracking, renderer clipboard TTL) plus drag/drop state so the tree supports VSCode-style Shift/Ctrl range selection, multi-item copy/cut/paste/delete, and drag-to-move/copy with drop target highlighting. `ExplorerView.tsx/.css` renders the new selection/dnd chrome (preview italics, drop outlines), and backend RPCs reuse the existing `explorer.pasteEntries` bridge for drag moves. (Dec 2025)
- **Markdown preview parity**: `.md/.mdx` tabs now respect the single preview slot because we debounce MDXEditor’s initial reformat pass inside `useEditorStore`. Tabs created via `createTabFromFile` receive a short canonicalization window (`nextMarkdownCanonicalizationExpiry`/`shouldCanonicalizeMarkdownChange`) so the first synthetic change updates both `content` and `savedContent` without flagging dirty/auto-pinning. Covered by `markdownCanonicalization.test.ts` to keep behavior stable. (Dec 2025)
- **Explorer git + diagnostics styling**: Introduced `GitStatusService` (per-workspace `.git` watchers + porcelain parser with `git.status` notifications/RPC) so `useExplorerStore` can hydrate renderer-owned git categories and aggregated LSP severities. Explorer rows now render Tabler file-type icons, git-colored labels, diagnostic dots, and tooltips via `ExplorerView.tsx/.css`, `src/lib/explorer/fileIcons.tsx`, and the new `uriToFsPath` helper. Validated with `electron/services/__tests__/gitStatusService.test.ts`. (Dec 2025)