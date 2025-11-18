---
id: 22936542-0e70-4f68-9ac9-4d89e3c6aa54
title: Preload bridge and renderer APIs
tags: [architecture, electron, preload]
files: [electron/preload.ts, src/store/index.ts]
createdAt: 2025-11-03T21:29:20.236Z
updatedAt: 2025-11-03T21:29:20.236Z
---

## WebSocket JSON-RPC backend bootstrap
- `electron/preload.ts` exposes a minimal `window.wsBackend.getBootstrap()` that provides the WS URL/token/windowId via query string. The renderer connects using `BackendClient` (src/lib/backend) and subscribes to notifications.

## Exposed preload APIs
- **Menu:** `window.menu.popup/on` for custom menu surfaces.
- **Window controls (WS JSON-RPC, not preload):** use `window.minimize`, `window.toggleMaximize` (alias: `window.maximize`), and `window.close` via the backend WebSocket JSON‑RPC.
- **App state:** `window.app.setView` keeps main-process menu state aligned with the active renderer view.
- **Filesystem:** `window.fs` supports cwd discovery, directory watching, and file read helpers via IPC.
- **Sessions & capabilities:** `window.sessions` CRUDs agent sessions; `window.capabilities.get` retrieves provider/tool capabilities.
- **Backend connection:** `window.wsBackend.getBootstrap()` only. Terminal, agent PTY, and other features are accessed via JSON-RPC methods (e.g., `terminal.*`, `agent-pty.*`) using the `BackendClient`.
- **Agent metrics & TypeScript refactors:** `window.agent.onMetrics` streams live agent telemetry; `window.tsRefactor` exposes MVP codemod endpoints.

## Listener hygiene
- Default max listeners for Node `EventEmitter` and `ipcRenderer` are raised to 50 to avoid warning spam during high-frequency dispatches.
