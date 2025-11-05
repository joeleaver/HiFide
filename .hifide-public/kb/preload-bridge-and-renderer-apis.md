---
id: 22936542-0e70-4f68-9ac9-4d89e3c6aa54
title: Preload bridge and renderer APIs
tags: [architecture, electron, preload]
files: [electron/preload.ts, src/store/index.ts]
createdAt: 2025-11-03T21:29:20.236Z
updatedAt: 2025-11-03T21:29:20.236Z
---

## Zubridge setup
- `electron/preload.ts` initializes `@zubridge/electron` handlers and exposes them as `window.zubridge`, enabling the renderer store (`src/store/index.ts`) to sync with the main-process Zustand store.

## Exposed preload APIs
- **Menu & window controls:** `window.menu.popup/on` for custom menu surfaces; `window.windowControls` wraps minimize/maximize/close.
- **App state:** `window.app.setView` keeps main-process menu state aligned with the active renderer view.
- **Filesystem:** `window.fs` supports cwd discovery, directory watching, and file read helpers via IPC.
- **Sessions & capabilities:** `window.sessions` CRUDs agent sessions; `window.capabilities.get` retrieves provider/tool capabilities.
- **PTY/terminal:** `window.pty` covers creation, write/resize/dispose, agent execution hooks, and data/exit event subscriptions.
- **Agent metrics & TypeScript refactors:** `window.agent.onMetrics` streams live agent telemetry; `window.tsRefactor` exposes MVP codemod endpoints.

## Listener hygiene
- Default max listeners for Node `EventEmitter` and `ipcRenderer` are raised to 50 to avoid warning spam during high-frequency dispatches.
