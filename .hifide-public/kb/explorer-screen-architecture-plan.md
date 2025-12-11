---
id: 410d3cb4-965a-4ffb-b411-5b5da67801ac
title: Explorer screen architecture plan
tags: [architecture, editor, explorer]
files: [src/components/ExplorerView.tsx, src/store/editor.ts, src/store/explorer.ts, src/store/utils/explorerPersistence.ts, src/store/utils/editorPersistence.ts, src/store/utils/markdownCanonicalization.ts, src/store/__tests__/markdownCanonicalization.test.ts, src/store/terminalTabs.ts, src/store/languageSupport.ts, src/lib/editor/markdownPlugins.ts, electron/services/ExplorerService.ts, electron/services/LanguageServerService.ts]
createdAt: 2025-12-08T22:51:20.088Z
updatedAt: 2025-12-10T22:54:13.900Z
---

---
id: 410d3cb4-965a-4ffb-b411-5b5da67801ac
title: Explorer screen architecture plan
tags: [architecture, editor, explorer]
files: [src/components/ExplorerView.tsx, src/store/editor.ts, src/store/explorer.ts, src/store/utils/explorerPersistence.ts, src/store/utils/editorPersistence.ts, src/store/utils/markdownCanonicalization.ts, src/store/__tests__/markdownCanonicalization.test.ts, src/store/terminalTabs.ts, src/store/languageSupport.ts, src/lib/editor/markdownPlugins.ts, electron/services/ExplorerService.ts, electron/services/LanguageServerService.ts]
createdAt: 2025-12-08T22:51:20.088Z
updatedAt: 2025-12-10T21:44:00.000Z
---

## Goals
- Deliver a VSCode-like explorer/editor/terminal view with persistent renderer state, tabbed Monaco editor, mdxeditor integration, multi-terminal PTY dock, and LSP-backed language tooling.
- Renderer owns local state/persistence; backend only handles filesystem + RPC requests (open/save/list/watch, PTY, LSP, etc.).
- Handle unsaved files being clobbered by external edits by silently reloading when the on-disk version is newer.
- Backend watches file changes and streams `explorer:fs:event` payloads to the renderer so explorer/editor/terminal stores stay in sync.

## Delivered workstreams (Dec 2025)
1. **Renderer explorer/editor stores**: `useExplorerStore`, `useEditorStore`, `useTerminalTabs`, and `useLanguageSupportStore` now own tree state, tabs, terminal metadata, markdown view preferences, and LSP install prompts. Persistence lives in `explorerPersistence`, `editorPersistence`, and `terminalPersistence` helpers so each workspace rehydrates instantly without extra RPCs.
2. **Backend RPC + watcher bridge**: `ExplorerService` handles list/read/write/create/rename/duplicate/delete/paste via chokidar watchers and workspace-scoped state. Websocket handlers expose `explorer.*` RPCs, stream `explorer.fs.event`, and reset explorer/editor/LSP stores on `workspace.attached`.
3. **Tabbed Monaco + mdxeditor**: `ExplorerView` now renders Monaco tabs (preview slots, dirty dots, markdown toggle) and mdxeditor with plugin registry (frontmatter, code fences, toolbar stack). Active tabs sync with the editor store + LSP client for diagnostics/completions.
4. **Terminal dock**: Renderer-owned terminal tabs (Explorer/Agent) persist cwd/shell/height, with resize + duplicate + rename flows. Terminal PTYs spin up via `terminalHandlers` and `WorkspaceManager` ensures watchers/PTYS attach when a window binds.
5. **Language server provisioning**: Mason-registry-driven provisioning downloads/install language servers on demand, with renderer prompts (Install / Always auto-install / Not now) and backend `LanguageServerService` bridging RPC + diagnostics.
6. **Renderer-driven menus**: `useViewStateStore` publishes renderer menu snapshots via `menu.updateState` RPC so Electron menus reflect current surface/workspace/dirty state (New/Open/Save/Save As only show on Explorer surface).
7. **Markdown toolbar fixes**: mdxeditor now handles `---` frontmatter + thematic breaks, uses shared plugin registry, and integrates the CodeMirror toolbar (language dropdown, inline formatting, list toggles).
8. **File tree polish**: Explorer tree rows follow VSCode styling (hover colors, active row, single-line labels) with resizable sidebar + Open Files pane, persisted width/height, and better loading indicators.
9. **Context menu + dialogs**: VSCode-style context menus (new/rename/duplicate/delete/copy/cut/paste) rely on renderer dialog prompts and RPC-backed filesystem actions, with clipboard TTL + cut highlighting.
10. **Multi-select & drag move**: Tree selection now mirrors VSCode (single anchor, Shift/Ctrl ranges, preview tab tying), clipboard actions operate on multi-selection, and drag/drop moves or copies batches with drop-target outlines and backend `pasteEntries` re-use.
11. **Markdown preview parity**: `.md/.mdx` tabs stay in preview mode until the user edits or double-clicks because `useEditorStore` temporarily canonicalizes MDXEditor’s reformatted content via `nextMarkdownCanonicalizationExpiry`, preventing synthetic dirty states.
12. **Git status & diagnostics styling**: Workspace watchers now feed a dedicated `GitStatusService` (porcelain parsing + `git.status` events). `useExplorerStore` merges git categories with aggregated LSP severities so `ExplorerView` can color rows, show diagnostic dots, and render Tabler file-type icons via `src/lib/explorer/fileIcons.tsx` and `src/lib/fs/uri.ts`. Tested by `electron/services/__tests__/gitStatusService.test.ts`.
13. **Workspace/Search sidebar modes** *(new)*: The sidebar header now exposes a segmented control (Workspace / Search) persisted via `explorerPersistence.sidebarMode`. Workspace mode renders the Open Files pane + explorer tree with their existing resizers; Search mode dedicates the entire column to `WorkspaceSearchPane`, eliminating the stacked layout, collapse button, and height juggling.

## Remaining backlog
- Workspace-wide find and replace panel (`task-cfa6e9d8-6da8-4b9d-99f6-6f46bf88a813`).