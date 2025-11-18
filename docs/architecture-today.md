# Architecture Today — WebSocket JSON‑RPC

Status: current source of truth for app architecture (replaces legacy zubridge docs)

## TL;DR
- Single source of truth for domain state lives in the main process (Zustand store in `electron/store`).
- Renderer does not mirror main state. It:
  - hydrates snapshots via JSON‑RPC requests, and
  - receives incremental updates via JSON‑RPC notifications.
- Renderer keeps small, renderer‑only Zustand stores for high‑frequency UI state (e.g., panel sizes, scroll, drag), and composes UI from snapshots + notifications.
- Transport is WebSocket with JSON‑RPC 2.0 using `vscode-jsonrpc` and `vscode-ws-jsonrpc`.
- Design is multi‑window and cloud‑ready by construction.

## Components & Ownership
- Main process (Electron):
  - Owns all domain state in a persisted Zustand store (`electron/store/index.ts`, slice per feature).
  - Executes flows, terminal/PTY lifecycle, workspace/indexing, provider access, persistence.
  - Exposes a JSON‑RPC server over WebSocket (`electron/backend/ws/server.ts`).
- Renderer:
  - Owns ephemeral UI state only (`src/store/ui.ts` and small local stores per view as needed).
  - Talks to backend only via JSON‑RPC client (`src/lib/backend/client.ts`).

## Transport & Protocol
- WebSocket (ws) on `127.0.0.1:<ephemeral>` with a random token for local dev; supports wss for cloud.
- JSON‑RPC 2.0 for request/response; streaming/progressive results use notifications.
- Libraries: `vscode-jsonrpc` (message protocol) + `vscode-ws-jsonrpc` (WS adapter).
- Naming: `noun.verb` (e.g., `view.get`, `view.set`). Notifications: `noun.event` (e.g., `session.usage.changed`).
- Conventions:
  - Single object parameters (stability + easy evolution).
  - Explicit result envelopes: `{ ok: boolean, ... }` for recoverable operations.
  - Keep payloads UI‑friendly but source‑of‑truth remains server types.

## Connection Lifecycle (Bootstrap)
1) Preload injects WS endpoint + token + windowId.
2) Renderer connects and calls `handshake.ping`/`handshake.init`.
3) Renderer subscribes to notifications it cares about.
4) Renderer hydrates initial UI state via `*.get` RPCs (e.g., `view.get`, `ui.getWindowState`, `session.getUsage`, `explorer.getState`).
5) UI mounts once snapshots and subscriptions are ready.

## State Patterns
- Snapshot + Notification:
  - Initial snapshot: `*.get` methods return the current state surface required by a view/component.
  - Deltas: notifications fire when the backend changes relevant portions (`session.usage.changed`, `explorer.state.changed`, etc.).
- Renderer local stores are minimal and UI‑only. Domain mutations always call RPCs (no direct domain state in renderer).
- Persistence occurs in main via Zustand `persist` with electron‑store (see `electron/store/index.ts`).

## Renderer Stores (UI‑Only)
- `src/store/ui.ts`: app‑level UI state (currentView mirror, panel widths, scroll, input value flags, collapsible panels).
- Other renderer‑only stores may exist per view for responsiveness (e.g., flow editor local graph state) but do not contain canonical data.

## Multi‑Window & Multi‑Root
- Each window gets its own WS connection and `windowId`.
- Per‑connection subscriptions prevent cross‑window leakage; broadcast used only for global events.
- Workspace root is part of handshake/open flow; future multi‑root/cloud backends pass via handshake capabilities.

## Persistence
- Main store persists selective slices using `persist` + `electron-store`.
- Sessions, settings, last‑used items, and window state persist in main.
- Project‑specific settings live in `.hifide/settings.json` inside the workspace folder.

## Flow Execution (Brief)
- Scheduler lives in main; executes nodes, handles tools, and emits events as notifications (e.g., tool start/end, chunks, errors).
- Renderer renders a simple timeline (one box per execution with inline badges) fed by notifications.
- Default node execution join is OR; special nodes implement AND joins as needed.

## Search & Knowledge Base (Brief)
- Unified search is executed in main with multiple lanes (ripgrep literal, semantic embeddings, AST‑grep) and merged results.
- KB uses a semantic index; integrated into the same search entrypoint roadmap.

## Error Handling & Reliability
- Main process swallows benign PTY/pipe errors; uses uncaught exception capture to prevent hard crashes.
- JSON‑RPC handler code must return `{ ok: false, error }` for expected failures.
- Renderer defends against stale snapshots by listening for notifications before taking action (subscribe‑then‑hydrate, then UI mount).

## Security
- Local dev: random token per process; connections must present it.
- Cloud: JWT support via `handshake.init` (roles/capabilities e.g., execPlane, providerPlane, fsAuthority, persistence).
- Sensitive files excluded from search and logs by default (see rules).

## API Design Guidelines
- Method names: `noun.verb` (get/set/do), notification names: `noun.event`.
- Single object params; avoid positional params.
- Keep response types stable; use additive changes.
- Streaming via notifications; no partial RPC responses.
- Time‑boxed handlers; long work in background + notify.

## Common RPCs in Use (non‑exhaustive)
- Handshake: `handshake.ping`, `handshake.init`
- View/UI: `view.get`, `view.set`, `ui.getWindowState`, `ui.updateWindowState`, `ui.toggleWindowState`
- Explorer/Editor: `explorer.getState`, `explorer.toggleFolder`, `editor.openFile`
- Sessions/Usage: `session.getUsage` + `session.usage.changed`
- Terminal: `terminal.addTab`, `terminal.removeTab`, `terminal.setActive`, `terminal.restartAgent`
- Flow: `flow.getNodeCache`, `flow.clearNodeCache`, `flowEditor.exportFlow`, `flowEditor.importFlow`

## Directory Map (anchors)
- Backend server: `electron/backend/ws/server.ts`
- Main store: `electron/store/index.ts` (+ `electron/store/slices/*`)
- Renderer UI store: `src/store/ui.ts`
- Backend client: `src/lib/backend/client.ts`
- App shell: `src/App.tsx`
- Example views: `src/components/AgentView.tsx`, `src/components/ExplorerView.tsx`, `src/components/TokensCostsPanel.tsx`

## Migration Note
- The legacy zubridge bridge has been fully removed from code and dependencies.
- Historical patterns remain documented at `.augment/rules/zustand-zubridge-patterns.md` with a DEPRECATED banner for context.

