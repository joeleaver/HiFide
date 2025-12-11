---
id: 895b5365-4109-49ed-9031-1f556ac45a8a
title: Renderer store refactor plan
tags: [explorer, editor, state, renderer]
files: [src/store/explorerScreenController.ts, src/store/explorer.ts, src/store/editor.ts, src/store/terminalTabs.ts, src/store/languageSupport.ts, src/store/viewState.ts, src/components/ExplorerView.tsx]
createdAt: 2025-12-09T17:54:43.810Z
updatedAt: 2025-12-09T20:01:41.624Z
---

## Goal
Ensure Explorer/editor/terminal React components remain pure render layers by moving business rules, side-effects, RPC orchestration, and persistence coordination into dedicated zustand stores.

## Approach
1. **Store-owned lifecycle hooks** – `initExplorerScreenController` orchestrates hydration, workspace resets, keyboard shortcuts, and terminal fitting without React effects. It waits for the backend client, hydrates explorer/editor/terminal state, and listens for hydration or workspace resets.
2. **Derived selectors instead of component state** – Language install prompts, markdown view mode, tab metadata, and terminal persistence all live in their respective stores. Components consume selectors strictly for rendering.
3. **Event + RPC orchestration in stores** – Keyboard shortcuts (Ctrl/Cmd+S), filesystem watcher handling, terminal fitting, and language provisioning RPCs dispatch from store actions/controllers rather than component `useEffect`s.
4. **Persistence utilities** – Shared persistence helpers remain responsible for workspace-scoped storage while stores own hydration timing. No React component tracks hydration phases directly.
5. **Monaco + editor lifecycle** – `useEditorStore` continues to manage Monaco models/URIs, while the view simply binds `beforeMount`/`onMount` for DOM concerns.
6. **View/menu sync pipeline** – `useViewStateStore` + `initViewStateController` track the active surface, workspace binding, and editor save affordances, publishing debounced `menu.updateState` RPCs so Electron menus stay in lock-step without React effects.

## Status (2025-01-09)
- Explorer hydration, terminal fitting, and save-shortcut logic live in `initExplorerScreenController`, keeping `ExplorerView` declarative.
- Language install prompts now rely on `useLanguageSupportStore` state (dismissed map, installing language, auto-install toggle) rather than component-local state.
- Renderer-driven menu sync landed: `useViewStateStore` snapshots Explorer/editor readiness and notifies Electron via `menu.updateState`, so File menu actions only appear/enabled when the Explorer surface + workspace actually support them.

## References
- Explorer architecture plan (`410d3cb4-965a-4ffb-b411-5b5da67801ac`)
- Editor implementation roadmap (`ce94b7ae-4a5a-414a-8d09-80d4dde01218`)
